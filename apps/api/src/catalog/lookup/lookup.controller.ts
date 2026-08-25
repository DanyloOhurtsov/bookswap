import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type { BookLookupResponse } from '@bookswap/shared'
import { SessionGuard } from '../../auth/session.guard'
import {
  CATALOG_LOOKUP_RATE_LIMIT,
  CATALOG_LOOKUP_RATE_WINDOW_MS,
} from '../../common/rate-limit.config'
import { LookupQueryDto } from './dto/lookup-query.dto'
import { LookupService } from './lookup.service'

/**
 * §11, R2: окремий бакет 'lookup' — кожен запит іде до зовнішнього провайдера
 * на cache miss, а попадання в кеш (R3) навмисно рахується так само: інакше
 * ліміт захищав би не наш процес перед Open Library, а лише повторний запит
 * того самого ISBN. Значення — env (`CATALOG_LOOKUP_RATE_LIMIT` /
 * `CATALOG_LOOKUP_RATE_WINDOW_MS`, дефолти в `.env.example`) — див.
 * `common/rate-limit.config.ts`.
 */
const CATALOG_LOOKUP_LIMIT = {
  lookup: { limit: CATALOG_LOOKUP_RATE_LIMIT, ttl: CATALOG_LOOKUP_RATE_WINDOW_MS },
}

/** §6.3, крок 1: автозаповнення форми додавання книги за ISBN. */
@Controller()
@UseGuards(SessionGuard)
export class LookupController {
  constructor(private readonly lookup: LookupService) {}

  @Get('catalog/lookup')
  @UseGuards(ThrottlerGuard)
  @Throttle(CATALOG_LOOKUP_LIMIT)
  async lookupByIsbn(@Query() dto: LookupQueryDto): Promise<BookLookupResponse> {
    return { result: await this.lookup.lookup(dto.isbn) }
  }
}
