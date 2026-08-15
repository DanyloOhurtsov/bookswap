import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { API_ERROR_CODES, type ApiError, type ApiErrorCode } from '@bookswap/shared'
import type { Response } from 'express'
import { readExplicitCode } from './api.exception'

/** Повідомлення для 5xx. Стале й беззмістовне — назовні не йде нічого внутрішнього. */
const INTERNAL_MESSAGE = 'Internal server error'

/**
 * Відповідність HTTP-статусу машиночитному коду (§8).
 *
 * Статус при цьому НЕ підміняється: 409 лишається 409, 429 лишається 429. Код —
 * додатковий машиночитний шар поверх статусу, а не заміна йому.
 */
const CODE_BY_STATUS: Readonly<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: API_ERROR_CODES.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: API_ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: API_ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: API_ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: API_ERROR_CODES.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: API_ERROR_CODES.TOO_MANY_REQUESTS,
}

// Свідомо звужено до number: HttpStatus — це enum, і пряме порівняння з довільним
// числовим статусом ловиться правилом no-unsafe-enum-comparison.
const SERVER_ERROR_FROM: number = HttpStatus.INTERNAL_SERVER_ERROR

function codeForStatus(status: number): ApiErrorCode {
  const mapped = CODE_BY_STATUS[status]
  if (mapped !== undefined) return mapped

  // Решта 4xx (405, 415, …) отримує загальний клієнтський код: помічати їх
  // як VALIDATION_ERROR чи INTERNAL_ERROR було б семантично хибно.
  return status >= SERVER_ERROR_FROM ? API_ERROR_CODES.INTERNAL_ERROR : API_ERROR_CODES.BAD_REQUEST
}

/** Дістає людиночитне повідомлення й деталі з тіла винятку Nest. */
function describe(response: string | object): { message: string; details?: unknown } {
  if (typeof response === 'string') return { message: response }

  const raw = (response as Record<string, unknown>).message

  // ValidationPipe (§11) віддає масив порушених обмежень — він іде в details,
  // а не склеюється в одне рядкове повідомлення.
  if (Array.isArray(raw)) return { message: 'Validation failed', details: raw }
  if (typeof raw === 'string' && raw.length > 0) return { message: raw }

  return { message: 'Request failed' }
}

/**
 * Єдина точка формування відповіді-помилки. Усе, що вилітає з застосунку,
 * набуває форми `apiErrorSchema` з `@bookswap/shared`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    const isHttp = exception instanceof HttpException
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const body = isHttp ? exception.getResponse() : undefined

    const explicitCode = body === undefined ? undefined : readExplicitCode(body)
    const code = explicitCode ?? codeForStatus(status)

    if (status >= SERVER_ERROR_FROM) {
      // Оригінальні message і stack лишаються в логах і не потрапляють у відповідь.
      this.logger.error(
        `${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      )

      response.status(status).json({ code, message: INTERNAL_MESSAGE } satisfies ApiError)
      return
    }

    const { message, details } = describe(body ?? { message: 'Request failed' })
    const payload: ApiError = details === undefined ? { code, message } : { code, message, details }

    response.status(status).json(payload)
  }
}
