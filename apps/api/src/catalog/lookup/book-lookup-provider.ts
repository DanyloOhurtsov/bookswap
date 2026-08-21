import type { BookLookupResult } from '@bookswap/shared'

/**
 * Порт зовнішнього ISBN-провайдера (§6.3, R1: Open Library — без ключа й без
 * квоти).
 *
 * Один метод, а не обгортка над усім API провайдера: сервісу потрібне рівно
 * одне — нормалізована відповідь на конкретний ISBN. `undefined` — провайдер
 * не знає такого ISBN (аналог HTTP 404), а не помилка; помилки провайдера
 * (мережа, неочікуване тіло, 5xx) кидаються як `BookLookupProviderError`.
 *
 * `signal` дозволяє реалізації скасувати власний мережевий виклик, коли
 * `LookupService` вичерпав таймаут — без нього провайдер, що ігнорує
 * скасування, тримав би сокет відкритим і після того, як відповідь клієнту
 * вже пішла.
 */
export interface BookLookupProvider {
  lookup(isbn: string, signal: AbortSignal): Promise<BookLookupResult | undefined>
}

/** DI-токен: інтерфейс TypeScript не існує в рантаймі. */
export const BOOK_LOOKUP_PROVIDER = 'BOOK_LOOKUP_PROVIDER'

/** Провайдер відповів, але не тим, на що можна покластися (мережа, 5xx, битий JSON). */
export class BookLookupProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookLookupProviderError'
  }
}
