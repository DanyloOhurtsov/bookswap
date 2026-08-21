import type { Work, WishlistItem, WorkAuthor } from '@bookswap/shared'

/**
 * Чиста логіка оптимістичного оновлення вішлиста (Етап 7f, DoD: «оптимістичне
 * оновлення відкочується при помилці»).
 *
 * Винесено з `use-wishlist.ts` так само, як `notification-preferences.ts` —
 * `apps/web` тестує лише `.ts` у `app/lib`, і саме тут живе правило, яке варте
 * перевірки без React: що саме показати в списку одразу після кліку, до
 * відповіді сервера.
 */

export function isInWishlist(items: readonly WishlistItem[], workId: string): boolean {
  return items.some((item) => item.workId === workId)
}

/** Дублікат не додається вдруге — той самий інваріант, що й `(userId, workId)` на сервері. */
export function withAdded(items: readonly WishlistItem[], item: WishlistItem): WishlistItem[] {
  if (isInWishlist(items, item.workId)) return [...items]

  return [item, ...items]
}

export function withRemoved(items: readonly WishlistItem[], workId: string): WishlistItem[] {
  return items.filter((item) => item.workId !== workId)
}

/**
 * Пункт списку до підтвердження сервером. `id` із префіксом `optimistic:` —
 * не справжній рядок бази, лише ключ для React-списку; членство в цей момент
 * рахується за `workId`, а справжній `id` приїжджає з наступним `reload()`.
 */
export function optimisticWishlistItem(work: Work, authors: WorkAuthor[]): WishlistItem {
  return {
    id: `optimistic:${work.id}`,
    workId: work.id,
    work,
    authors,
    createdAt: new Date().toISOString(),
  }
}
