'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  catalogSearchResponseSchema,
  workDetailResponseSchema,
  type CatalogSearchResponse,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { apiRequest, describeError } from './api'

/**
 * Ті самі три стани, що й у `useSession` та `useFriends`: «ще шукаю» і «нічого не
 * знайдено» — різні речі, і без цієї різниці сторінка блимає написом «нічого не
 * знайдено» при кожному натисканні.
 */
export type CatalogSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; response: CatalogSearchResponse }
  | { status: 'error'; message: string }

/**
 * Порожній запит — це `idle`, а не порожній пошук: до першого символу питати
 * сервер немає про що, а показувати «нічого не знайдено» — тим паче.
 *
 * Стан зберігається РАЗОМ із запитом, до якого належить, і поточний стан
 * виводиться під час рендеру. Це не ускладнення: інакше при зміні запиту в
 * інтерфейсі одну мить видно результати попереднього — з чужими книжками під
 * новим словом. Заразом зникає єдина причина писати `setState` просто в тілі
 * ефекту (React це прямо не радить, а ESLint — забороняє).
 */
export function useCatalogSearch(query: string): CatalogSearchState {
  const trimmed = query.trim()
  const enabled = trimmed.length >= 2
  const [result, setResult] = useState<{ query: string; state: CatalogSearchState }>({
    query: '',
    state: { status: 'idle' },
  })

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const response = await apiRequest(`/catalog/search?q=${encodeURIComponent(trimmed)}`, {
          schema: catalogSearchResponseSchema,
          signal: controller.signal,
        })

        setResult({ query: trimmed, state: { status: 'ready', response } })
      } catch (error) {
        if (controller.signal.aborted) return

        setResult({ query: trimmed, state: { status: 'error', message: describeError(error) } })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [trimmed, enabled])

  if (!enabled) return { status: 'idle' }

  // Відповідь на інший запит — це ще не відповідь на цей.
  return result.query === trimmed ? result.state : { status: 'loading' }
}

export type WorkState =
  | { status: 'loading' }
  | { status: 'ready'; detail: WorkDetailResponse }
  | { status: 'error'; message: string }

export function useWork(workId: string): { state: WorkState; reload: () => void } {
  const [state, setState] = useState<WorkState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const detail = await apiRequest(`/works/${encodeURIComponent(workId)}`, {
          schema: workDetailResponseSchema,
          signal: controller.signal,
        })

        setState({ status: 'ready', detail })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', message: describeError(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [workId, nonce])

  const reload = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  return { state, reload }
}
