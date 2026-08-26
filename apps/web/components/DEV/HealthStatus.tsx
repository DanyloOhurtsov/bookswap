'use client'

import { useEffect, useState } from 'react'
import {
  API_PREFIX,
  apiErrorSchema,
  healthResponseSchema,
  type HealthResponse,
} from '@bookswap/shared'

type State =
  { kind: 'loading' } | { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string }

// Інлайниться на етапі складання; єдина змінна, яку web отримує з кореневого .env.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * Клієнтський компонент навмисно.
 *
 * Запит до API виконується в рантаймі браузера, тож `next build` ніколи не
 * звертається до бекенду — складання проходить із зупиненим API. Відповідь
 * розбирається схемами з `@bookswap/shared`, тими самими, якими API її формує.
 */
export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const response = await fetch(`${API_URL}${API_PREFIX}/health`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const body: unknown = await response.json()

        if (!response.ok) {
          const error = apiErrorSchema.safeParse(body)
          setState({
            kind: 'error',
            message: error.success
              ? `${error.data.code}: ${error.data.message}`
              : `HTTP ${response.status}`,
          })
          return
        }

        const parsed = healthResponseSchema.safeParse(body)
        setState(
          parsed.success
            ? { kind: 'ok', data: parsed.data }
            : { kind: 'error', message: 'Відповідь не відповідає контракту health' },
        )
      } catch {
        if (controller.signal.aborted) return
        setState({ kind: 'error', message: `API недоступний за адресою ${API_URL}` })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [])

  if (state.kind === 'loading') {
    return <p className="status status--pending">Перевіряю звʼязок з API…</p>
  }

  if (state.kind === 'error') {
    return (
      <p className="status status--error">
        <strong>Немає звʼязку.</strong> {state.message}
      </p>
    )
  }

  return (
    <p className="status status--ok">
      <strong>API відповідає.</strong> Версія {state.data.version}, аптайм{' '}
      {state.data.uptimeSeconds.toFixed(1)} с.
    </p>
  )
}
