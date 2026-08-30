'use client'

import type { Work, WorkAuthor } from '@bookswap/shared'
import { FormStatus } from '@/components/Form/FormStatus'
import type { WishlistController } from '@/app/lib/use-wishlist'

/**
 * Кнопка додати/прибрати твір із вішлиста (Етап 7f, DoD).
 *
 * Оптимістичне оновлення й відкат живуть у `useWishlist` — тут лише напис і
 * клік, щоб ту саму логіку без копіювання підключити й до рядка на сторінці
 * вішлиста.
 *
 * Поки перший `GET /me/wishlist` не приїхав, `wishlist.items` — `undefined`:
 * кнопка не малюється взагалі, а не в невизначеному стані «додати чи
 * прибрати» — членства ще просто не виднa
 */
export function WishlistButton({
  work,
  authors,
  wishlist,
}: {
  work: Work
  authors: WorkAuthor[]
  wishlist: WishlistController
}) {
  if (wishlist.items === undefined) return null

  const member = wishlist.isMember(work.id)
  const busy = wishlist.isPending(work.id)

  // `member` уже відображає ОПТИМІСТИЧНУ ціль mutation, що летить: `busy &&
  // member` — саме той момент, коли рядок щойно з'явився в списку, тобто
  // додається; `busy && !member` — щойно зник, тобто прибирається.
  return (
    <div className="person__actions">
      <button
        type="button"
        className={member ? 'button--danger' : undefined}
        disabled={busy}
        onClick={() => {
          void (member ? wishlist.remove(work.id) : wishlist.add(work, authors))
        }}
      >
        {member
          ? busy
            ? 'Додаю…'
            : 'Прибрати з вішлиста'
          : busy
            ? 'Прибираю…'
            : 'Додати у вішлист'}
      </button>
      <FormStatus error={wishlist.actionError} />
    </div>
  )
}
