import { z } from 'zod'

/**
 * §4.8, enum `NotificationType`.
 *
 * Значення дублюють Prisma-enum — причина та сама, що в `domain/visibility.ts`.
 * Парність тримає `apps/api/src/common/enum-parity.spec.ts`.
 *
 * **`LOAN_CANCELLED` — свідоме доповнення до §4.8.** §5.1 для переходу
 * `APPROVED → CANCELLED` вимагає «сповіщення другій стороні», але типу під нього
 * в §4.8 немає. Переприсвоїти `LOAN_REJECTED` не можна: «вам відмовили» і
 * «домовленість скасовано» — різні події, і на етапі 3 різниця поїде в текст
 * листа й повідомлення в Telegram. Деталі — в README.
 *
 * `REQUESTED → CANCELLED` і `HANDED_OVER → LOST` сповіщень не породжують: у §5.1
 * ці рядки мають порожню клітинку побічних ефектів, і це не пропуск.
 */
export const NOTIFICATION_TYPE = [
  'LOAN_REQUESTED',
  'LOAN_APPROVED',
  'LOAN_REJECTED',
  'LOAN_CANCELLED',
  'LOAN_HANDED_OVER',
  'LOAN_RETURNED',
  'LOAN_DUE_SOON',
  'LOAN_OVERDUE',
  'FRIEND_REQUESTED',
  'FRIEND_ACCEPTED',
] as const

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPE)

export type NotificationType = z.infer<typeof notificationTypeSchema>
