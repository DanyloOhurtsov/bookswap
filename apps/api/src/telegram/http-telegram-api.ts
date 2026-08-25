import { Injectable, Logger } from '@nestjs/common'
import { TelegramConfig } from './telegram.config'
import type {
  TelegramApi,
  TelegramCallbackAnswer,
  TelegramMessageDraft,
  TelegramMessageEdit,
} from './telegram-api'

const API_ROOT = 'https://api.telegram.org'

/** Скільки чекати на Bot API. Диспетчер має тик у 30 секунд — довше тримати нема сенсу. */
const REQUEST_TIMEOUT_MS = 10_000

/** Bot API завжди відповідає цим конвертом, і на помилках теж. */
interface BotApiResponse {
  ok: boolean
  description?: string
  error_code?: number
}

/**
 * Помилка Bot API, з якою диспетчер піде на ретрай (§7.3, правило 2).
 *
 * Окремий клас, щоб у `NotificationDelivery.error` лягав розбірливий опис від
 * Telegram, а не `TypeError: fetch failed`. Це той рядок, який читатимуть, коли
 * доставка ляже у `FAILED`.
 */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    description: string,
  ) {
    super(`Telegram ${method}: ${String(status)} ${description}`)
    this.name = 'TelegramApiError'
  }
}

/**
 * Справжній транспорт (§7.4).
 *
 * Голий `fetch` без SDK: три виклики, кожен — POST із JSON. Мережевих ретраїв тут
 * немає навмисно — ними завідує диспетчер, і другий шар повторів усередині каналу
 * зробив би `attempts` у таблиці неправдою.
 */
@Injectable()
export class HttpTelegramApi implements TelegramApi {
  private readonly logger = new Logger(HttpTelegramApi.name)

  constructor(private readonly config: TelegramConfig) {}

  async sendMessage(draft: TelegramMessageDraft): Promise<void> {
    await this.call('sendMessage', {
      chat_id: draft.chatId,
      text: draft.text,
      // Один ряд кнопок; порожню клавіатуру не надсилаємо взагалі, щоб не
      // отримати повідомлення з порожньою панеллю під ним.
      ...(draft.buttons.length === 0
        ? {}
        : {
            reply_markup: {
              inline_keyboard: [
                draft.buttons.map((button) => ({
                  text: button.text,
                  callback_data: button.callbackData,
                })),
              ],
            },
          }),
    })
  }

  async answerCallbackQuery(answer: TelegramCallbackAnswer): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: answer.callbackQueryId,
      text: answer.text,
    })
  }

  async editMessageText(edit: TelegramMessageEdit): Promise<void> {
    // `reply_markup` не передаємо — саме це й прибирає кнопки з повідомлення
    // після ухваленого рішення.
    await this.call('editMessageText', {
      chat_id: edit.chatId,
      message_id: edit.messageId,
      text: edit.text,
    })
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    // Токен у шляху — так влаштований Bot API. У лог він не потрапляє: нижче
    // друкується лише назва методу.
    const url = `${API_ROOT}/bot${this.token()}/${method}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const payload = (await response.json().catch(() => undefined)) as BotApiResponse | undefined

    if (!response.ok || payload?.ok !== true) {
      throw new TelegramApiError(
        method,
        response.status,
        payload?.description ?? 'відповідь без опису помилки',
      )
    }

    this.logger.debug(`Telegram ${method}: ok`)
  }

  private token(): string {
    this.config.assertConfigured()

    // `assertConfigured` уже впав би на `undefined`; порожній рядок тут
    // недосяжний і потрібен лише типам.
    return this.config.botToken ?? ''
  }
}
