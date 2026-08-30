'use client'

import Link from 'next/link'
import { AuthorLine } from '@/components/BookParts'
import { FormStatus } from '@/components/Form/FormStatus'
import { SessionBoundary } from '@/components/SessionBoundary'
import { Shell } from '@/components/Shell'
import { assertNever } from '../../lib/assert-never'
import { useWishlist } from '../../lib/use-wishlist'

/**
 * §6.5 і §8, підетап 7f: сторінка вішлиста — список творів і кнопка «Прибрати»
 * на кожен. Оптимістичне оновлення й відкат при помилці — у `useWishlist`,
 * тут лише малювання.
 */
export default function WishlistPage() {
  return (
    <SessionBoundary title="Вішлист" description="Список творів, які ви хочете прочитати.">
      <WishlistScreen />
    </SessionBoundary>
  )
}

function WishlistScreen() {
  const wishlist = useWishlist()

  if (wishlist.items === undefined) {
    switch (wishlist.state.status) {
      case 'error':
        return (
          <Shell title="Вішлист" description="Список творів, які ви хочете прочитати.">
            <FormStatus error={new Error(wishlist.state.message)} />
          </Shell>
        )
      case 'loading':
      case 'ready':
        return (
          <Shell title="Вішлист" description="Список творів, які ви хочете прочитати.">
            <p className="status status--pending">Завантажую…</p>
          </Shell>
        )
      default:
        return assertNever(wishlist.state)
    }
  }

  return (
    <Shell title="Вішлист" description="Список творів, які ви хочете прочитати.">
      {wishlist.refreshing && <p className="status status--pending">Оновлюю…</p>}

      {wishlist.backgroundErrorMessage !== undefined && (
        <FormStatus error={new Error(`Не вдалося оновити: ${wishlist.backgroundErrorMessage}`)} />
      )}

      <FormStatus error={wishlist.actionError} />

      {wishlist.items.length === 0 ? (
        <p className="empty">
          Тут поки порожньо. Додайте твір кнопкою «Додати у вішлист» на сторінці книжки.
        </p>
      ) : (
        <ul className="books">
          {wishlist.items.map((item) => (
            <li className="book" key={item.workId}>
              <Link className="book__title" href={`/works/${item.workId}`}>
                {item.work.title}
              </Link>
              <AuthorLine authors={item.authors} />

              <div className="person__actions">
                <button
                  type="button"
                  className="button--danger"
                  disabled={wishlist.isPending(item.workId)}
                  onClick={() => {
                    void wishlist.remove(item.workId)
                  }}
                >
                  {wishlist.isPending(item.workId) ? 'Прибираю…' : 'Прибрати'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}
