import { z } from 'zod'

/**
 * §8: помилки API мають машиночитний `code`.
 *
 * Тут лише **загальні інфраструктурні** коди — ті, без яких не працює транспортний
 * рівень. Доменні коди (`LOAN_*`, `FRIENDSHIP_*`, `COPY_*` тощо) свідомо не
 * заводяться наперед: кожен приходить разом зі своєю функціональністю, інакше
 * половина каталогу лишиться мертвою або розійдеться з реальною поведінкою.
 */
export const API_ERROR_CODES = {
  /** Тіло чи параметри запиту не пройшли валідацію (HTTP 400). */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Синтаксично коректний, але неприйнятний запит без окремішнього коду (405, 415, …). */
  BAD_REQUEST: 'BAD_REQUEST',
  /** Немає автентифікації (HTTP 401). */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Автентифікація є, прав бракує (HTTP 403). */
  FORBIDDEN: 'FORBIDDEN',
  /** Ресурс не знайдено (HTTP 404). */
  NOT_FOUND: 'NOT_FOUND',
  /** Конфлікт стану — напр. порушення унікальності (HTTP 409). */
  CONFLICT: 'CONFLICT',
  /** Спрацював rate limiting §11 (HTTP 429). */
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  /** Непередбачена помилка сервера (HTTP 5xx). Деталі назовні не віддаються. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // --- Акаунт і сесії (§6.1) -------------------------------------------------
  /** Реєстрація на вже зайнятий email (HTTP 409). */
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  /**
   * Логін не вдався (HTTP 401). Один код і на невідомий email, і на хибний
   * пароль: різні коди перетворили б форму входу на перевірку «чи є такий акаунт».
   */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Одноразовий токен із листа недійсний: не існує, прострочений або вже використаний (HTTP 400). */
  INVALID_TOKEN: 'INVALID_TOKEN',
} as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES]

// Object.values() втрачає непорожність, а z.enum() вимагає саме непорожній кортеж.
// Об'єкт вище — літерал, тож звуження безпечне.
const apiErrorCodeValues = Object.values(API_ERROR_CODES) as [ApiErrorCode, ...ApiErrorCode[]]

export const apiErrorCodeSchema = z.enum(apiErrorCodeValues)

/**
 * Єдина форма відповіді-помилки для всього API. `apps/web` розбирає нею будь-який
 * неуспішний відгук, `apps/api` нею ж формує вихід глобального фільтра винятків.
 */
export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  details: z.unknown().optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>
