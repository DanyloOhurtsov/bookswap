import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type {
  CatalogSearchResponse,
  EditionDetailResponse,
  EditionResponse,
  TranslationListResponse,
  TranslationResponse,
  WorkDetailResponse,
} from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { CatalogService } from './catalog.service'
import {
  CatalogSearchDto,
  CreateEditionDto,
  CreateTranslationDto,
  CreateWorkDto,
} from './dto/catalog.dto'
import type { UserModel } from '../generated/prisma/models'

/**
 * §11: rate limiting саме на створення `Work` / `Edition` — це антиспам каталогу.
 * Каталог спільний, тож зіпсувати його може будь-хто автентифікований (§6.3), і
 * єдине, що стоїть між базою і скриптом, — цей ліміт.
 */
const CATALOG_WRITE_LIMIT = { auth: { limit: 30, ttl: 60 * 60_000 } }

/** Перебір бази триграмами дорожчий за звичайний запит — стримуємо як пошук людей. */
const CATALOG_SEARCH_LIMIT = { auth: { limit: 60, ttl: 60_000 } }

@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog/search')
  @UseGuards(ThrottlerGuard)
  @Throttle(CATALOG_SEARCH_LIMIT)
  search(@Query() dto: CatalogSearchDto): Promise<CatalogSearchResponse> {
    return this.catalog.search(dto.q)
  }

  @Get('works/:id')
  getWork(@Param('id') id: string): Promise<WorkDetailResponse> {
    return this.catalog.getWork(id)
  }

  @Get('works/:id/translations')
  listTranslations(@Param('id') id: string): Promise<TranslationListResponse> {
    return this.catalog.listTranslations(id)
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
