import { Logger } from '@nestjs/common'
import { notificationPayloadSchema, type Notification } from '@bookswap/shared'
import type { NotificationModel } from '../generated/prisma/models'

const logger = new Logger('NotificationsMapper')

export type NotificationRow = Pick<
  NotificationModel,
  'id' | 'type' | 'payload' | 'readAt' | 'createdAt'
>

/**
 * `payload` у базі — колонка `Json` (§4.8), тобто на читанні її форма нічим не
 * гарантована: рядок міг лягти туди старішою версією коду або міграцією.
 *
 * Три можливі реакції, і дві з них погані. Впасти — зробити весь список
 * сповіщень недоступним через один зіпсований рядок. Тихо підставити `{}` —
 * сховати проблему назавжди: UI просто мовчки не покаже посилання, і ніхто
 * ніколи не дізнається, чому.
 *
 * Тому третя: явний безпечний fallback **плюс** запис у лог. У лог іде id
 * сповіщення і **шляхи** проблемних полів — не значення: саме в них можуть
 * лежати чужі ідентифікатори, а лог від цього не захищений.
 */
function toPayload(row: NotificationRow): Notification['payload'] {
  const parsed = notificationPayloadSchema.safeParse(row.payload)

  if (parsed.success) return parsed.data

  logger.warn(
    `Сповіщення ${row.id}: payload не відповідає контракту, віддано порожній. ` +
      `Поля: ${parsed.error.issues.map((issue) => issue.path.join('.') || '<корінь>').join(', ')}`,
  )

  return {}
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    payload: toPayload(row),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}
