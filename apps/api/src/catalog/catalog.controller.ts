import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type {
  ApiError,
  CatalogSearchResponse,
  EditionDetailResponse,
  EditionResponse,
  TranslationListResponse,
  TranslationResponse,
  WorkDetailResponse,
} from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { CATALOG_WRITE_RATE_LIMIT, CATALOG_WRITE_RATE_WINDOW_MS } from '../common/rate-limit.config'
import { CanonicalWorkService } from './canonical/canonical-work.service'
import { redirectToCanonicalWork } from './canonical/work-redirect'
import { CatalogService } from './catalog.service'
import {
  CatalogSearchDto,
  CreateEditionDto,
  CreateTranslationDto,
  CreateWorkDto,
} from './dto/catalog.dto'
import type { Response } from 'express'
import type { UserModel } from '../generated/prisma/models'

/**
 * §11: rate limiting саме на створення `Work` / `Edition` — це антиспам каталогу.
 * Каталог спільний, тож зіпсувати його може будь-хто автентифікований (§6.3), і
 * єдине, що стоїть між базою і скриптом, — цей ліміт.
 *
 * Значення конфігуруються через env (`CATALOG_WRITE_RATE_LIMIT` /
 * `CATALOG_WRITE_RATE_WINDOW_MS`, дефолти в `.env.example`) — див.
 * `common/rate-limit.config.ts` про те, чому вони функції, а не числа.
 */
const CATALOG_WRITE_LIMIT = {
  auth: { limit: CATALOG_WRITE_RATE_LIMIT, ttl: CATALOG_WRITE_RATE_WINDOW_MS },
}

/** Перебір бази триграмами дорожчий за звичайний запит — стримуємо як пошук людей. */
const CATALOG_SEARCH_LIMIT = { auth: { limit: 60, ttl: 60_000 } }

@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly canonical: CanonicalWorkService,
  ) {}

  @Get('catalog/search')
  @UseGuards(ThrottlerGuard)
  @Throttle(CATALOG_SEARCH_LIMIT)
  search(@Query() dto: CatalogSearchDto): Promise<CatalogSearchResponse> {
    return this.catalog.search(dto.q)
  }

  /**
   * §6.3: a merged work answers 301 on the canonical one — see
   * `canonical/work-redirect.ts`. `@Res({ passthrough: true })` gives the
   * redirect its headers while Nest still serialises the returned body.
   */
  @Get('works/:id')
  async getWork(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkDetailResponse | ApiError> {
    const resolved = await this.canonical.resolve(id)

    if (resolved.moved) return redirectToCanonicalWork(response, resolved)

    return this.catalog.getWork(resolved.workId)
  }

  @Get('works/:id/translations')
  async listTranslations(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TranslationListResponse | ApiError> {
    const resolved = await this.canonical.resolve(id)

    if (resolved.moved) return redirectToCanonicalWork(response, resolved, '/translations')

    return this.catalog.listTranslations(resolved.workId)
  }

  @Post('works')
  @UseGuards(ThrottlerGuard)
  @Throttle(CATALOG_WRITE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  createWork(
    @CurrentUser() user: UserModel,
    @Body() dto: CreateWorkDto,
  ): Promise<WorkDetailResponse> {
    return this.catalog.createWork(user.id, dto)
  }

  @Post('works/:id/translations')
  @UseGuards(ThrottlerGuard)
  @Throttle(CATALOG_WRITE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  createTranslation(
    @Param('id') id: string,
    @Body() dto: CreateTranslationDto,
  ): Promise<TranslationResponse> {
    return this.catalog.createTranslation(id, dto)
  }

  @Post('works/:id/editions')
  @UseGuards(ThrottlerGuard)
  @Throttle(CATALOG_WRITE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  createEdition(
    @CurrentUser() user: UserModel,
    @Param('id') id: string,
    @Body() dto: CreateEditionDto,
  ): Promise<EditionResponse> {
    return this.catalog.createEdition(user.id, id, dto)
  }

  @Get('editions/:id')
  getEdition(@Param('id') id: string): Promise<EditionDetailResponse> {
    return this.catalog.getEdition(id)
  }
}
