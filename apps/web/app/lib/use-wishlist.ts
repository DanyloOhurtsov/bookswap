'use client'

import { useState } from 'react'
import {
  wishlistResponseSchema,
  type WishlistItem,
  type WishlistResponse,
  type Work,
  type WorkAuthor,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from './api'
import { displayDecision, type ResourceState } from './resource-state'
import { useApiResource } from './use-resource'
import { isInWishlist, optimisticWishlistItem, withAdded, withRemoved } from './wishlist'

export interface WishlistController {
  /** Сирий стан GET-запиту — для повноекранного «Завантажую…»/помилки, поки жодних даних ще не було. */
  state: ResourceState<WishlistResponse>
  /** `undefined` лише поки не приїхала жодна успішна відповідь. */
  items: WishlistItem[] | undefined
  refreshing: boolean
  backgroundErrorMessage: string | undefined
  actionError: unknown
  isPending: (workId: string) => boolean
  isMember: (workId: string) => boolean
  add: (work: Work, authors: WorkAuthor[]) => Promise<void>
  remove: (workId: string) => Promise<void>
}

/**
 * §6.5 і §8, підетап 7f.
 *
 * Один хук на дві сторінки — список вішлиста (де рядок зникає) і кнопку на
 * творі (де вона перемикається) — бо обидві мають той самий обов'язок:
 * показати зміну одразу, не чекаючи відповіді сервера, і відкотити її, якщо
 * запит не вдався. Друга копія цієї логіки одного дня розійшлася б із першою.
 *
 * Оптимістичний оверлей рахується поверх останньої відповіді сервера тим
 * самим прийомом `lastData`/`displayDecision`, що й у налаштуваннях сповіщень:
 * `state.status` стає `loading` на КОЖЕН фоновий `reload()`, а список має
 * лишатися на екрані, поки летить свіжіша версія.
 */
export function useWishlist(): WishlistController {
  const { state, reload } = useApiResource('/me/wishlist', wishlistResponseSchema)
  const [lastData, setLastData] = useState<WishlistResponse>()

  if (state.status === 'ready' && state.data !== lastData) setLastData(state.data)

  const { data, refreshing, backgroundErrorMessage } = displayDecision(state, lastData)

  /**
   * `undefined` — оверлею нема, показуємо `data.items` як є. З'являється в
   * момент кліку (до відповіді сервера) і зникає одразу після успішного
   * `reload()`, коли сервер знову стає єдиним джерелом правди.
   */
  const [overlay, setOverlay] = useState<WishlistItem[]>()
  const [actionError, setActionError] = useState<unknown>()
  const [pendingWorkIds, setPendingWorkIds] = useState<ReadonlySet<string>>(new Set())

  const items = overlay ?? data?.items

  function setPending(workId: string, pending: boolean): void {
    setPendingWorkIds((current) => {
      const next = new Set(current)

      if (pending) next.add(workId)
      else next.delete(workId)

      return next
    })
  }

  async function add(work: Work, authors: WorkAuthor[]): Promise<void> {
    if (items === undefined) return

    const before = items

    setActionError(undefined)
    setPending(work.id, true)
    setOverlay(withAdded(before, optimisticWishlistItem(work, authors)))

    try {
      await apiRequest('/me/wishlist', { method: 'POST', body: { workId: work.id } })
      // Замінює тимчасовий пункт справжнім (реальний `id`, `createdAt` із сервера).
      await reload()
      setOverlay(undefined)
    } catch (error) {
      setOverlay(before)
      setActionError(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(work.id, false)
    }
  }

  async function remove(workId: string): Promise<void> {
    if (items === undefined) return

    const before = items

    setActionError(undefined)
    setPending(workId, true)
    setOverlay(withRemoved(before, workId))

    try {
      await apiRequest(`/me/wishlist/${encodeURIComponent(workId)}`, { method: 'DELETE' })
      await reload()
      setOverlay(undefined)
    } catch (error) {
      setOverlay(before)
      setActionError(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(workId, false)
    }
  }

  return {
    state,
    items,
    refreshing,
    backgroundErrorMessage,
    actionError,
    isPending: (workId) => pendingWorkIds.has(workId),
    isMember: (workId) => items !== undefined && isInWishlist(items, workId),
    add,
    remove,
  }
}
