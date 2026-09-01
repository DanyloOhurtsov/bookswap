'use client'

import { ApiRequestError } from '@/app/lib/api'

/**
 * Повідомлення про результат надсилання форми.
 *
 * `role="alert"` навмисно: після сабміту фокус лишається на кнопці, і без цього
 * екранний читач про помилку просто не скаже. Для успіху — `role="status"`,
 * бо він не має переривати те, що зачитується.
 */
export function FormStatus({ error, success }: { error?: unknown; success?: string }) {
  if (error !== undefined && error !== null) {
    const constraints = error instanceof ApiRequestError ? error.constraints : []
    const message = error instanceof Error ? error.message : String(error)

    return (
      <div className="alert alert--error" role="alert">
        <p>{message}</p>
        {constraints.length > 0 && (
          <ul>
            {constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (success !== undefined) {
    return (
      <div className="alert alert--ok" role="status">
        <p>{success}</p>
      </div>
    )
  }

  return null
}
