import { z } from 'zod'
import { NOTIFICATION_TYPE, notificationTypeSchema } from '../domain/notification'
import { PREFERENCE_CHANNEL, preferenceChannelSchema } from '../domain/channel'

/**
 * §7 і §8, блок «Сповіщення»: читання in-app, матриця «тип × канал» (§7.6) і
 * прив'язка Telegram (§7.4).
 *
 * `NotificationDelivery` назовні не віддається жодним ендпоінтом, і це навмисно:
 * стан конкретної доставки — внутрішня справа диспетчера (§7.3, правило 2).
 * Користувачеві корисно знати, чи канал **підключений** (`channels` нижче), а не
 * чи третя спроба надіслати лист чекає на четверту.
 */

/**
 * §4.8: «loanId, copyId, actorId тощо» — самі ідентифікатори.
 *
 * Рядок-до-рядка, а не довільний JSON: усі корисні поля тут — це id, а вужчий
 * тип позбавляє потреби в `any` на межі з `Prisma.InputJsonValue`. Той самий тип
 * використовує `NotificationsService` на записі.
 */
export const notificationPayloadSchema = z.record(z.string(), z.string())

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  payload: notificationPayloadSchema,
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export type Notification = z.infer<typeof notificationSchema>

/**
 * §8: `GET /me/notifications?unread=true`.
 *
 * Прапорець описаний парою рядків із перетворенням, а не `z.stringbool()`:
 * `ValidationPipe` в `apps/api` налаштований із `enableImplicitConversion: false`,
 * тож query-параметр приїжджає рядком, а тест парності DTO↔zod звіряє **вироки**
 * обох механізмів. Широку множину синонімів `stringbool` («1», «yes», «on», …)
 * довелося б дослівно повторити в `class-validator`, і перша ж розбіжність
 * пройшла б непоміченою.
 */
export const unreadFlagSchema = z.enum(['true', 'false']).transform((value) => value === 'true')

export const notificationQueryRequestSchema = z.object({
  unread: unreadFlagSchema.optional(),
})

export type NotificationQueryRequest = z.infer<typeof notificationQueryRequestSchema>

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  /**
   * Рахується завжди, навіть коли список відфільтровано за `unread`: лічильник
   * у навігації не має залежати від того, яку вкладку зараз відкрито.
   */
  unreadCount: z.number().int().nonnegative(),
})

export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>

export const notificationResponseSchema = z.object({ notification: notificationSchema })

export type NotificationResponse = z.infer<typeof notificationResponseSchema>

/** §8: `POST /me/notifications/read-all`. Скільки рядків справді змінилося. */
export const readAllResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
})

export type ReadAllResponse = z.infer<typeof readAllResponseSchema>

// --- Налаштування «тип × канал» (§7.6) --------------------------------------

/**
 * Одна клітинка матриці — для **будь-якого** з трьох каналів §4.8, `IN_APP`
 * включно (див. `domain/channel.ts`).
 */
export const notificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  channel: preferenceChannelSchema,
  enabled: z.boolean(),
})

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>

/**
 * Скільки клітинок узагалі існує. Ліміт на тіло `PUT` — рівно розмір матриці:
 * більше означало б дублікати, і краще сказати про це до звернення до бази.
 */
export const NOTIFICATION_PREFERENCE_LIMITS = {
  matrixSize: NOTIFICATION_TYPE.length * PREFERENCE_CHANNEL.length,
} as const

/**
 * Стан каналів (§7.2 і §7.4), а не стан доставок.
 *
 * Три різні питання, які легко злити в одне й на цьому помилитися:
 *
 * - `configured` — **сервер** уміє цей канал. Telegram без `TELEGRAM_BOT_TOKEN`
 *   не вміє ніхто й ніколи; це властивість розгортання, а не акаунта.
 * - `connected` — **акаунт** підключив канал (є `chat_id`, підтверджена адреса).
 * - `available` — обидва разом, тобто «доставка сюди справді відбудеться».
 *
 * Клієнт мусить бачити їх окремо, бо дії різні: непідключений канал показує
 * кнопку «Підключити», неналаштований — не показує нічого, і жодна кнопка тут не
 * допоможе. Одне поле `available` змусило б UI писати «підключіть Telegram» там,
 * де підключати нема до чого.
 */
export const channelAvailabilitySchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  available: z.boolean(),
})

export const notificationChannelsSchema = z.object({
  /** In-app доступний завжди: він не потребує ні конфігурації, ні підключення. */
  inApp: channelAvailabilitySchema,
  email: channelAvailabilitySchema.extend({
    address: z.email(),
    /** §6.1. Доки адресу не підтверджено, лист туди не піде — див. `available`. */
    verified: z.boolean(),
  }),
  telegram: channelAvailabilitySchema,
})

export type ChannelAvailability = z.infer<typeof channelAvailabilitySchema>
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>

/**
 * §8: `GET /me/notification-preferences`.
 *
 * Віддається **вся** матриця, а не лише рядки з бази: відсутність рядка означає
 * «як за замовчуванням» (§7.6), і клієнт, який отримав би сам лише збережені
 * клітинки, мусив би повторювати політику дефолтів у себе. Вона й так живе в
 * `shared` (`defaultPreferenceEnabled`), але порахувати її один раз на сервері —
 * менше місць, де можна помилитися.
 */
export const notificationPreferencesResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
  channels: notificationChannelsSchema,
})

export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>

/**
 * §8: `PUT /me/notification-preferences`.
 *
 * `PUT`, але не «замінити все на надіслане»: клітинки, яких немає в тілі,
 * лишаються як були. Повна заміна вимагала б від клієнта надсилати матрицю
 * цілком навіть заради одного перемикача — і будь-який новий тип події
 * старіший клієнт мовчки скидав би до дефолту.
 *
 * Дублікати `type × channel` відхиляються, а не «перемагає останній»: два різні
 * значення однієї клітинки в одному тілі — це помилка клієнта, і тихо обрати
 * одне з них означає зберегти не те, що людина бачила на екрані.
 */
export const updateNotificationPreferencesRequestSchema = z.object({
  preferences: z
    .array(notificationPreferenceSchema)
    .min(1, 'Порожній список нічого не змінює')
    .max(NOTIFICATION_PREFERENCE_LIMITS.matrixSize)
    .refine(
      (rows) => new Set(rows.map((row) => `${row.type}:${row.channel}`)).size === rows.length,
      'Одна клітинка матриці згадана двічі',
    ),
})

export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesRequestSchema
>

// --- Прив'язка Telegram (§7.4) ----------------------------------------------

/**
 * §8: `POST /me/telegram/link → { deepLink }`.
 *
 * `expiresAt` віддається разом із посиланням, бо TTL — 10 хвилин, і UI мусить
 * мати змогу сказати «посилання протухло», а не вести людину в бота, який
 * відповість відмовою.
 */
export const telegramLinkResponseSchema = z.object({
  deepLink: z.url(),
  expiresAt: z.iso.datetime(),
})

export type TelegramLinkResponse = z.infer<typeof telegramLinkResponseSchema>
