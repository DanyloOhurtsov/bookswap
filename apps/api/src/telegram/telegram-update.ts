import { z } from 'zod'
import { LOAN_CALLBACK_PREFIX } from '../notifications/notification-renderer'
import type { LoanAction } from '@bookswap/shared'

/**
 * Розбір того, що надсилає Telegram (§7.4).
 *
 * Чистий модуль без залежностей від Nest і бази: саме тут живуть два рішення, у
 * яких найлегше помилитися й найдорожче — довіра до `callback_data` і формат
 * `/start`. Перевіряються вони без жодного HTTP.
 *
 * Валідація — zod, а не DTO з `class-validator`, і це не відступ від §11. Тіло
 * вебхука приходить не від нашого клієнта, а від Telegram, і воно **завжди**
 * містить поля, яких ми не описували: глобальний `ValidationPipe` із
 * `forbidNonWhitelisted: true` відхилив би кожне друге оновлення тільки за те, що
 * в ньому є `entities` чи `chat_instance`. Тому схема нижче навмисно пропускає
 * невідоме й вимагає лише те, що читає обробник.
 */

const chatSchema = z.object({
  id: z.number(),
  /**
   * `private` | `group` | `supergroup` | `channel`.
   *
   * Не звужується до enum навмисно: невідомий тип чату має доїхати до обробника
   * й бути там відхиленим як «не приватний», а не зникнути на валідації разом з
   * усім оновленням.
   */
  type: z.string().optional(),
})

const fromSchema = z.object({
  id: z.number(),
})

const messageSchema = z.object({
  message_id: z.number(),
  chat: chatSchema,
  from: fromSchema.optional(),
  text: z.string().optional(),
})

/**
 * `message` у колбеку може бути «недоступним» (`MaybeInaccessibleMessage`) — так
 * Telegram позначає надто старі повідомлення. Тоді редагувати нема чого, але сам
 * колбек лишається дійсним, тож поле необов'язкове.
 */
const callbackQuerySchema = z.object({
  id: z.string(),
  from: fromSchema,
  data: z.string().optional(),
  message: messageSchema.optional(),
})

export const telegramUpdateSchema = z.object({
  update_id: z.number().optional(),
  message: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
})

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>
export type TelegramCallbackQuery = z.infer<typeof callbackQuerySchema>
export type TelegramMessage = z.infer<typeof messageSchema>

/**
 * §7.4, крок 3: «бот отримує `/start <token>` разом із `chat_id`».
 *
 * Голий `/start` без аргументу — не помилка, а звичайне відкриття бота з пошуку;
 * повертаємо `null`, і обробник відповідає підказкою.
 *
 * `/start@BotName <token>` теж приймається: саме таку форму Telegram надсилає,
 * коли команду набрано в групі. Прив'язку з групи ми не робимо (§7.2 прямо
 * відкидає спільну групу), але розбір форми — не те місце, де це вирішувати.
 */
export function parseStartToken(text: string | undefined): string | null {
  if (text === undefined) return null

  const match = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/.exec(text.trim())

  return match?.[1] ?? null
}

export interface LoanCallback {
  action: Extract<LoanAction, 'approve' | 'reject'>
  loanId: string
}

/**
 * §7.4: «`callback_data` приходить від клієнта; довіряти їй не можна».
 *
 * Ця функція робить рівно одне — розбирає **форму** рядка. Вона не знає ні про
 * лоани, ні про права, і саме тому не може випадково стати авторизацією:
 * повернутий `loanId` — це неперевірений рядок від клієнта, і викликач
 * зобов'язаний з'ясувати, чи має право цей `chat_id` щось із ним робити.
 *
 * Множина дій навмисно вужча за `LOAN_ACTIONS`: із повідомлення доступні тільки
 * відповіді на запит. `hand_over` чи `mark_lost` кнопкою під старим повідомленням
 * — це спосіб натиснути «втрачено» через півроку, не бачачи контексту.
 */
export function parseLoanCallback(data: string | undefined): LoanCallback | null {
  if (data === undefined) return null

  const match = new RegExp(`^${LOAN_CALLBACK_PREFIX}:(approve|reject):([A-Za-z0-9_-]{1,64})$`).exec(
    data,
  )

  if (match === null) return null

  const [, action, loanId] = match

  if (action === undefined || loanId === undefined) return null

  return { action: action === 'approve' ? 'approve' : 'reject', loanId }
}

/** `chat_id` у базі — рядок (`User.telegramChatId`), у Telegram — число. */
export function chatIdOf(id: number): string {
  return String(id)
}

/**
 * Чи це приватний чат 1:1 із тим, хто написав.
 *
 * §7.2 прямо відкидає спільну групу як канал: «усі бачать, хто в кого що просить
 * (суперечить §6.6); немає адресації конкретній людині; немає способу довести, що
 * `@username` у групі — власник акаунта». Прив'язка акаунта до групи повернула б
 * рівно ці три проблеми — і додала б четверту: інлайн-кнопки «Погодити» під
 * чужим запитом стали б доступні всім учасникам.
 *
 * Двох перевірок замало поодинці. `chat.type === 'private'` відсікає групи, але в
 * Telegram приватний чат має `chat.id`, що дорівнює `from.id` відправника; якщо
 * вони розійшлися, це не той сценарій, який ми розуміємо, — і прив'язувати
 * акаунт до нього не можна.
 */
export function isPrivateSender(message: TelegramMessage): boolean {
  return message.chat.type === 'private' && message.from?.id === message.chat.id
}
