import { timingSafeEqual } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { API_ERROR_CODES } from '@bookswap/shared'
import { ApiException } from '../common/api.exception'

/**
 * Конфігурація бота (§7.4) в одному місці.
 *
 * Три змінні оточення валідуються комплектом ще на старті (`env.validation.ts`),
 * тож тут лишається одне питання: налаштований бот чи ні. Відповідь на нього
 * потрібна трьом різним місцям — кнопці «Підключити», каналу доставки й вебхуку, —
 * і виводити її з `undefined` у кожному було б трьома шансами помилитися.
 */
@Injectable()
export class TelegramConfig {
  constructor(private readonly config: ConfigService) {}

  get botToken(): string | undefined {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN')
  }

  get botUsername(): string | undefined {
    return this.config.get<string>('TELEGRAM_BOT_USERNAME')
  }

  get webhookSecret(): string | undefined {
    return this.config.get<string>('TELEGRAM_WEBHOOK_SECRET')
  }

  /** Комплектність гарантує `env.validation.ts`; тут досить перевірити одну змінну. */
  get configured(): boolean {
    return this.botToken !== undefined
  }

  /** §7.4, крок 2: `t.me/<BotName>?start=<token>`. */
  deepLink(token: string): string {
    const username = this.botUsername

    if (username === undefined) throw notConfigured()

    return `https://t.me/${username}?start=${encodeURIComponent(token)}`
  }

  assertConfigured(): void {
    if (!this.configured) throw notConfigured()
  }

  /**
   * Перевірка заголовка `X-Telegram-Bot-Api-Secret-Token`.
   *
   * Це **єдиний** механізм автентифікації, який Telegram дає для вебхука бота:
   * підпису тіла в Bot API немає, тож секрет із `setWebhook` — усе, що відрізняє
   * справжнє оновлення від чужого POST на відкритий маршрут.
   *
   * Порівняння постійного часу, бо секрет фіксований і живе довго: звичайний `===`
   * зупиняється на першому розбіжному байті, і тисячі спроб дають вимірювану
   * різницю. Довжини звіряються окремо — `timingSafeEqual` кидає на різних.
   *
   * Бот не налаштований → відмова. «Секрету немає, тож пускаємо всіх» перетворило
   * б забуту змінну на відкритий маршрут, який змінює стан лоанів.
   */
  matchesWebhookSecret(candidate: string | undefined): boolean {
    const expected = this.webhookSecret

    if (expected === undefined || candidate === undefined) return false

    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(candidate, 'utf8')

    return a.length === b.length && timingSafeEqual(a, b)
  }
}

function notConfigured(): ApiException {
  return new ApiException(
    API_ERROR_CODES.TELEGRAM_NOT_CONFIGURED,
    'Telegram-бот не налаштований на цьому сервері',
    HttpStatus.SERVICE_UNAVAILABLE,
  )
}
