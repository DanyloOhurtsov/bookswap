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
  /**
   * Додаткові заголовки запиту.
   *
   * Існують заради серверного рендеру: у Node немає сховища кукі, тож
   * `credentials: 'include'` там не робить нічого, і сесію доводиться класти в
   * `Cookie` вручну (`api.server.ts`). У браузері не використовується — кукі
   * додає сам fetch.
   */
  headers?: Record<string, string>
}

/**
 * A response together with the one transport fact the caller may need: whether
 * it arrived through a redirect.
 *
 * §6.3 answers 301 on a `Work` that was merged away, and `fetch` follows that
 * silently — the parsed body is already the canonical work. Silence is exactly
 * the problem: the page would render the right book under the old URL, and the
 * next person to copy that URL out of the address bar would spread a dead link.
 * `redirected` is what lets the page rewrite it.
 *
 * The canonical id itself is NOT read back out of the URL — it is in the parsed
 * body, typed by the shared contract. This flag only says that a move happened.
 */
export interface ApiResponse<T> {
  data: T
  redirected: boolean
}

/**
 * Єдина точка звернення до API.
 *
 * `credentials: 'include'` обов'язковий: автентифікація тримається на кукі (§6.1),
 * і без цього прапорця fetch її просто не надсилає.
 */
export async function apiRequestWithRedirect<T = void>(
  path: string,
  { method = 'GET', body, schema, signal, headers }: RequestOptions<T> = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_URL}${API_PREFIX}${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    signal,
    headers: {
      ...(body === undefined ? undefined : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const redirected = response.redirected

  if (response.status === 204) return { data: undefined as T, redirected }

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

  if (schema === undefined) return { data: undefined as T, redirected }

  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    throw new Error('Відповідь API не відповідає спільному контракту')
  }

  return { data: parsed.data, redirected }
}

/** The common case: the body is all the caller wants. */
export async function apiRequest<T = void>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const { data } = await apiRequestWithRedirect<T>(path, options)

  return data
}

/** Мережа лягла — це не помилка API, і повідомлення має бути іншим. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return ''

  return `Не вдалося звʼязатися з API за адресою ${API_URL}`
}
