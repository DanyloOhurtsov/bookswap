import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { API_ERROR_CODES } from '@bookswap/shared'
import { ApiException } from '../common/api.exception'
import { TelegramConfig } from './telegram.config'
import { TelegramUpdateService } from './telegram-update.service'

/** Заголовок, у якому Telegram повертає `secret_token` із `setWebhook`. */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

/**
 * §8: `POST /webhooks/telegram`.
 *
 * Єдиний маршрут API без `SessionGuard`, і тому єдиний, який доводиться захищати
 * окремо. Bot API не підписує тіло — увесь механізм автентифікації, який Telegram
 * дає для вебхука бота, це `secret_token`, переданий у `setWebhook` і повернутий
 * заголовком на кожному запиті. Його ми й звіряємо, порівнянням постійного часу
 * (`TelegramConfig.matchesWebhookSecret`).
 *
 * Далі не довіряємо нічому: тіло розбирає zod, актор виводиться з `chat_id`, а
 * права на конкретний примірник перевіряються окремо (§7.4).
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly config: TelegramConfig,
    private readonly updates: TelegramUpdateService,
  ) {}

  /**
   * `@Body() body: unknown`, а не DTO з `class-validator`, — і це не пропуск §11.
   *
   * Глобальний `ValidationPipe` працює з `whitelist: true, forbidNonWhitelisted:
   * true`, тобто відхиляє будь-яке незнайоме поле. Telegram надсилає їх десятками
   * (`entities`, `chat_instance`, `link_preview_options`, усе нове з кожної версії
   * Bot API), і сувора DTO означала б, що половина оновлень мовчки стає 400. Тому
   * рантайм-валідація тут є, але робить її zod-схема, яка вимагає потрібне й
   * пропускає решту — див. `telegram-update.ts`.
   *
   * Відповідь — завжди 200 із порожнім тілом. Будь-який інший код Telegram читає
   * як «не дійшло» і повторює те саме оновлення; помилка обробки в нас не
   * виправиться від повтору, зате повтор надішле друге повідомлення тій самій людині.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Headers(SECRET_HEADER) secret: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, never>> {
    if (!this.config.matchesWebhookSecret(secret)) {
      // 401 тут — не для Telegram (він секрет знає), а для всіх інших. Це
      // єдиний випадок, коли відповідь не 200: не пускати ж чужий POST далі,
      // щоб він мовчки нічого не зробив.
      throw new ApiException(
        API_ERROR_CODES.UNAUTHORIZED,
        'Невірний секрет вебхука',
        HttpStatus.UNAUTHORIZED,
      )
    }

    await this.updates.handle(body)

    return {}
  }
}
