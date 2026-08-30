import { NotificationList } from '@/components/Notification/NotificationList'
import { SessionBoundary } from '@/components/SessionBoundary'

/**
 * §7 і §8: центр in-app сповіщень.
 *
 * Канали назовні (email, Telegram) — етап 3: без диспетчера й `NotificationDelivery`
 * тут не було б чого показувати, крім вічного `PENDING`.
 */
export default function NotificationsPage() {
  return (
    <SessionBoundary title="Сповіщення" description="Перегляньте свої сповіщення про події.">
      <NotificationList />
    </SessionBoundary>
  )
}
