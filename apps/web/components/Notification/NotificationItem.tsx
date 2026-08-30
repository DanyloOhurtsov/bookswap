import Link from 'next/link'
import type { Notification } from '@bookswap/shared'
import { NOTIFICATION_TYPE_LABELS, formatDate } from '@/app/lib/labels'

function NotificationItem({
  notification,
  busyKey,
  onRead,
}: {
  notification: Notification
  busyKey: string | undefined
  onRead: () => void
}) {
  const unread = notification.readAt === null
  const loanId = notification.payload.loanId

  return (
    <li className={unread ? 'person notification--unread' : 'person'}>
      <div className="person__who">
        <span className="person__name">{NOTIFICATION_TYPE_LABELS[notification.type]}</span>
        <span className="person__meta">
          {formatDate(notification.createdAt)}
          {unread && ' · нове'}
        </span>
      </div>

      <div className="person__actions">
        {loanId !== undefined && <Link href={`/loans?loanId=${loanId}`}>Відкрити позичання</Link>}
        {unread && (
          <button
            type="button"
            className="button--ghost"
            disabled={busyKey !== undefined}
            onClick={onRead}
          >
            {busyKey === `read:${notification.id}` ? 'Позначаю…' : 'Прочитано'}
          </button>
        )}
      </div>
    </li>
  )
}
export { NotificationItem }
