import { API_PREFIX, apiErrorSchema, type ApiError, type ApiErrorCode } from '@bookswap/shared'
import type { ZodType } from 'zod'

// Інлайниться на етапі складання; єдина змінна, яку web отримує з кореневого .env.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * Помилка, яку віддав API, з машиночитним `code` (§8).
 *
 * Окремий клас, а не рядок: сторінкам треба розрізняти випадки — 401 веде на
 * логін, EMAIL_TAKEN підсвічує поле, решта показується як є.
 */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: unknown

  constructor(status: number, error: ApiError) {
    super(error.message)
    this.name = 'ApiRequestError'
    this.code = error.code
    this.status = status
    this.details = error.details
  }

  /**
   * `ValidationPipe` віддає масив порушених обмежень у `details`. Показати їх
   * корисніше, ніж загальне «Validation failed».
   */
  get constraints(): string[] {
    return Array.isArray(this.details) ? this.details.map(String) : []
  }
}

interface RequestOptions<T> {
  // `PUT` — заради `PUT /me/notification-preferences` (§8): клієнт надсилає стан
  // клітинок матриці, а не інструкцію їх змінити, і повторний однаковий запит
  // нічого не змінює.
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Схема з `@bookswap/shared`, якою розбирається успішна відповідь. */
  schema?: ZodType<T>
  signal?: AbortSignal
}

/**
 * Єдина точка звернення до API.
 *
 * `credentials: 'include'` обов'язковий: автентифікація тримається на кукі (§6.1),
 * і без цього прапорця fetch її просто не надсилає.
 */
export async function apiRequest<T = void>(
  path: string,
  { method = 'GET', body, schema, signal }: RequestOptions<T> = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${API_PREFIX}${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json().catch(() => undefined)

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload)

    throw new ApiRequestError(
      response.status,
      parsed.success
        ? parsed.data
        : { code: 'INTERNAL_ERROR', message: `HTTP ${String(response.status)}` },
    )
  }

  if (schema === undefined) return undefined as T

  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    throw new Error('Відповідь API не відповідає спільному контракту')
  }

  return parsed.data
}

/** Мережа лягла — це не помилка API, і повідомлення має бути іншим. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return ''

  return `Не вдалося звʼязатися з API за адресою ${API_URL}`
}
