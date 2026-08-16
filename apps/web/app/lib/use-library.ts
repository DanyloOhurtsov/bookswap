'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  borrowedLibraryResponseSchema,
  libraryResponseSchema,
  visibleLibraryResponseSchema,
  type BorrowedLibraryGroup,
  type LibraryGroup,
  type LibraryQueryRequest,
  type PublicUser,
  type VisibleLibraryGroup,
} from '@bookswap/shared'
import { apiRequest, describeError } from './api'

/**
 * §6.4: три в'ю однієї бібліотеки — «мої», «мої не вдома», «чужі в мене» — і
 * третє повертає інший тип примірника (там видно власника, але не його нотатки).
 * Тому стан параметризований групою, а не один на всі випадки.
 */
export type LibraryView = 'own' | 'out' | 'borrowed'

export type LibraryState =
  | { status: 'loading' }
  | { status: 'ready'; view: 'own' | 'out'; groups: LibraryGroup[] }
  | { status: 'ready'; view: 'borrowed'; groups: BorrowedLibraryGroup[] }
  | { status: 'error'; message: string }

const PATHS: Readonly<Record<LibraryView, string>> = {
  own: '/me/library',
  out: '/me/library/out',
  borrowed: '/me/library/borrowed',
}

/** Фільтри §8 у рядок запиту. Порожні значення не додаються — це «без фільтра». */
function toQuery(filters: LibraryQueryRequest): string {
  const parameters = new URLSearchParams()

  if (filters.status !== undefined) parameters.set('status', filters.status)
  if (filters.lang !== undefined) parameters.set('lang', filters.lang)
  if (filters.q !== undefined) parameters.set('q', filters.q)

  const query = parameters.toString()

  return query === '' ? '' : `?${query}`
}

export function useLibrary(
  view: LibraryView,
  filters: LibraryQueryRequest,
): { state: LibraryState; reload: () => void } {
  const [state, setState] = useState<LibraryState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  // Фільтри — обʼєкт, тож у списку залежностей має бути його вміст, а не він сам:
  // новий літерал на кожен рендер запускав би запит нескінченно.
  const query = view === 'own' ? toQuery(filters) : ''

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        if (view === 'borrowed') {
          const response = await apiRequest(PATHS.borrowed, {
            schema: borrowedLibraryResponseSchema,
            signal: controller.signal,
          })

          setState({ status: 'ready', view: 'borrowed', groups: response.groups })
          return
        }

        const response = await apiRequest(`${PATHS[view]}${query}`, {
          schema: libraryResponseSchema,
          signal: controller.signal,
        })

        setState({ status: 'ready', view, groups: response.groups })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', message: describeError(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [view, query, nonce])

  const reload = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  return { state, reload }
}

export type FriendLibraryState =
  | { status: 'loading' }
  | { status: 'ready'; owner: PublicUser; groups: VisibleLibraryGroup[] }
  | { status: 'error'; message: string }

/**
 * Бібліотека іншої людини. Рішення «чи можна це бачити» ухвалює API (§9), тож
 * фронт не фільтрує нічого — він показує рівно те, що приїхало.
 */
export function useFriendLibrary(userId: string): FriendLibraryState {
  const [state, setState] = useState<FriendLibraryState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const response = await apiRequest(`/users/${encodeURIComponent(userId)}/library`, {
          schema: visibleLibraryResponseSchema,
          signal: controller.signal,
        })

        setState({ status: 'ready', owner: response.owner, groups: response.groups })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', message: describeError(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [userId])

  return state
}
