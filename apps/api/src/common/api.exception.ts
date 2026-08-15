import { HttpException } from '@nestjs/common'
import { apiErrorCodeSchema, type ApiErrorCode } from '@bookswap/shared'

/**
 * Виняток, який несе машиночитний `code` (§8).
 *
 * Глобальний фільтр віддає цей код назовні без змін — саме так доменні винятки
 * наступних етапів (`LOAN_*`, `FRIENDSHIP_*`) зможуть задавати власні коди, не
 * чіпаючи фільтр. Без цього класу контракт «явний code зберігається» неможливо
 * було б протестувати.
 */
export class ApiException extends HttpException {
  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(details === undefined ? { code, message } : { code, message, details }, status)
  }
}

/** Чи несе відповідь винятку явно заданий машиночитний код. */
export function readExplicitCode(response: unknown): ApiErrorCode | undefined {
  if (typeof response !== 'object' || response === null) return undefined

  const parsed = apiErrorCodeSchema.safeParse((response as Record<string, unknown>).code)

  return parsed.success ? parsed.data : undefined
}
