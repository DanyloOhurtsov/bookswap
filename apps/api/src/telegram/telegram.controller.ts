import { Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type { TelegramLinkResponse } from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { TelegramLinkService } from './telegram-link.service'
import type { UserModel } from '../generated/prisma/models'

/**
 * §11: «Rate limiting… на генерацію Telegram-токенів».
 *
 * Кожен виклик створює рядок у базі й гасить попередній токен цієї людини, тож
 * без ліміту вкладка з автооновленням перетворилася б на генератор сміття. Десять
 * на годину — з великим запасом на «натиснув, не побачив, натиснув ще».
 */
const LINK_LIMIT = { limit: 10, ttl: 60 * 60_000 }

/** §8: прив'язка Telegram — маршрути профілю, під сесією. */
@Controller('me/telegram')
@UseGuards(SessionGuard)
export class TelegramController {
  constructor(private readonly links: TelegramLinkService) {}

  /** §8: `POST /me/telegram/link → { deepLink }`. */
  @Post('link')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: LINK_LIMIT })
  createLink(@CurrentUser() user: UserModel): Promise<TelegramLinkResponse> {
    return this.links.createLink(user.id)
  }

  /** §8: `DELETE /me/telegram` — відв'язати. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  unlink(@CurrentUser() user: UserModel): Promise<void> {
    return this.links.unlink(user.id)
  }
}
