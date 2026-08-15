'use client'

import { useCallback, useEffect, useState } from 'react'
import { sessionResponseSchema, type Me } from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from './api'

/**
 * Три стани, а не `user | null`: «ще перевіряю» і «точно гість» — різні речі.
 * Без цієї різниці захищена сторінка блимає формою логіну на кожному оновленні.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'authenticated'; user: Me }
  | { status: 'error'; message: string }

export function useSession(): {
  state: SessionState
  reload: () => void
  setUser: (user: Me) => void
} {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const { user } = await apiRequest('/auth/session', {
          schema: sessionResponseSchema,
          signal: controller.signal,
        })

        setState({ status: 'authenticated', user })
      } catch (error) {
        if (controller.signal.aborted) return

        // 401 — це не збій, а відповідь «ти не залогінений».
        if (error instanceof ApiRequestError && error.status === 401) {
          setState({ status: 'guest' })
          return
        }

        setState({ status: 'error', message: describeError(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [nonce])

  const reload = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  const setUser = useCallback((user: Me) => {
    setState({ status: 'authenticated', user })
  }, [])

  return { state, reload, setUser }
}
