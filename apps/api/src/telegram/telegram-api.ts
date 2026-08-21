/**
 * Порт Bot API (§7.4).
 *
 * Рівно чотири операції, які потрібні сервісу, а не обгортка над усім Bot API:
 * надіслати повідомлення, відповісти на натискання кнопки, прибрати кнопки після
 * рішення і сказати Telegram, куди слати оновлення. Ширший інтерфейс довелося б
 * повторювати у фейку, а кожен зайвий метод у фейку — це код, який ніхто не
 * викликає й ніщо не перевіряє.
 *
 * Бібліотеки (`telegraf`, `node-telegram-bot-api`) не беремо: вони приносять
 * власний роутер оновлень і власну модель сесій, а нам потрібні чотири HTTP-виклики
 * на `fetch`, який у Node 22 уже є.
 */

/** §7.4: `callback_data` виду `loan:approve:<loanId>`. Telegram обмежує його 64 байтами. */
export interface TelegramInlineButton {
  text: string
  callbackData: string
}

export interface TelegramMessageDraft {
  chatId: string
  text: string
  /** Один ряд кнопок. Порожній масив означає повідомлення без клавіатури. */
  buttons: readonly TelegramInlineButton[]
}

export interface TelegramCallbackAnswer {
  callbackQueryId: string
  text: string
}

export interface TelegramMessageEdit {
  chatId: string
  messageId: number
  text: string
}

/**
 * Помилки транспорту.
 *
 * Метод **кидає** — так само, як `EmailSender`. Диспетчер однаково мусить ловити
 * все, що прилетить із мережі, і другий канал повідомлення про збій означав би
 * дві гілки обробки замість однієї.
 */
export interface TelegramApi {
  sendMessage(draft: TelegramMessageDraft): Promise<void>
  answerCallbackQuery(answer: TelegramCallbackAnswer): Promise<void>
  editMessageText(edit: TelegramMessageEdit): Promise<void>
}

/** DI-токен: інтерфейс TypeScript не існує в рантаймі. */
export const TELEGRAM_API = 'TELEGRAM_API'
