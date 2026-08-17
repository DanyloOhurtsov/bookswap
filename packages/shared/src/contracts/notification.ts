import { z } from 'zod'
import { notificationTypeSchema } from '../domain/notification'

/**
 * §7 і §8, блок «Сповіщення» — поки лише in-app читання.
 *
 * `NotificationDelivery`, канали й налаштування «тип × канал» (§7.6) сюди не
 * входять: рядок доставки має сенс лише разом із воркером, який його забирає
 * (§7.3, правило 2). Це етап 3 зі §14.
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
