import { z } from 'zod'
import { isbn13Schema } from '../domain/isbn'

/**
 * §6.3, крок 1 і §11: автозаповнення форми додавання книги за ISBN.
 *
 * Джерело правди лишається власна база (§6.3) — зовнішній провайдер лише
 * пропонує чернетку полів, тому вся форма нижче опційна, крім `title`: без
 * назви показувати автозаповнення нема сенсу, решту користувач і так
 * редагує руками перед збереженням.
 */

export const bookLookupRequestSchema = z.object({
  isbn: isbn13Schema,
})

export type BookLookupRequest = z.infer<typeof bookLookupRequestSchema>

/**
 * Нормалізована форма, спільна для всіх провайдерів (Open Library і будь-який
 * майбутній).
 *
 * `externalId` — суто довідковий (§6.3: «зовнішній ID не зберігається як
 * залежність»): клієнт не зобов'язаний його передавати назад при створенні
 * `Work`/`Edition`, і бекенд ніде на нього не посилається через FK.
 */
export const bookLookupResultSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).optional(),
  publishedYear: z.number().int().optional(),
  language: z.string().optional(),
  publisher: z.string().optional(),
  coverUrl: z.string().optional(),
  externalId: z.string().optional(),
})

export type BookLookupResult = z.infer<typeof bookLookupResultSchema>

export const bookLookupResponseSchema = z.object({
  result: bookLookupResultSchema,
})

export type BookLookupResponse = z.infer<typeof bookLookupResponseSchema>
