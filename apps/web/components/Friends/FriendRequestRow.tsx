import type { FriendRequest } from '@bookswap/shared'
import { CheckIcon, XIcon } from 'lucide-react'
import { formatDate } from '@/app/lib/labels'
import { UserAvatar } from '@/components/Friends/UserAvatar'
import { Button } from '@/components/ui/button'

interface FriendRequestRowProps {
  request: FriendRequest
  direction: 'incoming' | 'outgoing'
  busyKey: string | undefined
  onAccept?: () => void
  onDecline?: () => void
  onCancel?: () => void
}

function FriendRequestRow({
  request,
  direction,
  busyKey,
  onAccept,
  onDecline,
  onCancel,
}: FriendRequestRowProps) {
  const busy = busyKey !== undefined

  return (
    <li className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <UserAvatar user={request.user} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{request.user.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {direction === 'incoming'
            ? `Хоче додати вас у друзі · ${formatDate(request.createdAt)}`
            : `Надіслано ${formatDate(request.createdAt)} · очікує відповіді`}
        </p>
      </div>

      {direction === 'incoming' ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            disabled={busy}
            aria-label={`Прийняти запит від ${request.user.displayName}`}
            onClick={onAccept}
          >
            <CheckIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            aria-label={`Відхилити запит від ${request.user.displayName}`}
            onClick={onDecline}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          disabled={busy}
          onClick={onCancel}
        >
          <XIcon aria-hidden="true" />
          {busyKey === `remove:${request.user.id}` ? 'Скасовую…' : 'Скасувати'}
        </Button>
      )}
    </li>
  )
}

export { FriendRequestRow }
