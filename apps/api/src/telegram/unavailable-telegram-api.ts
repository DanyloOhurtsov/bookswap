import { Injectable } from '@nestjs/common'
import type {
  TelegramApi,
  TelegramCallbackAnswer,
  TelegramMessageDraft,
  TelegramMessageEdit,
} from './telegram-api'

/** Помилка, з якої видно, що це конфігурація, а не збій Telegram. */
export class TelegramNotConfiguredError extends Error {
  constructor() {
    super(
      'Telegram-бот не налаштований: немає TELEGRAM_BOT_TOKEN. ' +
        'Канал недоступний — жодного повідомлення не надіслано.',
    )
    this.name = 'TelegramNotConfiguredError'
  }
}

/**
 * Транспорт, який чесно каже «не можу» (§7.2).
 *
 * Підіймається в production, коли бота не налаштовано. Альтернатив було дві, і
 * обидві гірші:
 *
 * - **Фейк, що повертає успіх.** Доставка стає `SENT`, хоча нікому нічого не
 *   надіслано. Черга §7.3 перестає означати те, що означає, а дізнаються про це
 *   зі скарги людини, яка не отримала запит на власну книжку.
 * - **Падіння застосунку на старті.** Telegram — опційний канал (§7.2: «email —
 *   базовий канал, увімкнений завжди; Telegram — опційний»). Не давати сервісу
 *   піднятися через відсутність опційного каналу означає зробити його
 *   обов'язковим.
 *
 * Тому третя: канал існує, але кожна спроба ним скористатися — явна помилка з
 * текстом у `NotificationDelivery.error`. На практиці сюди не доходить:
 * `channelsFor` не створює `TELEGRAM`-доставок, поки бот не налаштований. Цей
 * клас — рубіж на випадок рядків, що лишилися в черзі з часів, коли токен був.
 */
@Injectable()
export class UnavailableTelegramApi implements TelegramApi {
  sendMessage(_draft: TelegramMessageDraft): Promise<void> {
    return Promise.reject(new TelegramNotConfiguredError())
  }

  answerCallbackQuery(_answer: TelegramCallbackAnswer): Promise<void> {
    return Promise.reject(new TelegramNotConfiguredError())
  }

  editMessageText(_edit: TelegramMessageEdit): Promise<void> {
    return Promise.reject(new TelegramNotConfiguredError())
  }
}
