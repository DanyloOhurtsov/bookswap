import type { ZodError, ZodType } from 'zod'

export type FieldErrors = Record<string, string>

/**
 * Перше повідомлення на кожне поле — саме те, що показується під інпутом.
 *
 * Валідація на клієнті тими самими схемами, якими користується API: це не заміна
 * серверній перевірці (та лишається джерелом правди), а спосіб не гнати запит
 * заради «пароль закороткий».
 */
export function toFieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {}

  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.') || 'form'

    errors[path] ??= issue.message
  }

  return errors
}

export function validate<T>(
  schema: ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const parsed = schema.safeParse(value)

  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, errors: toFieldErrors(parsed.error) }
}
