import type { BookLookupResult } from '@bookswap/shared'
import {
  BookLookupProviderError,
  type BookLookupProvider,
} from '../../src/catalog/lookup/book-lookup-provider'

type Outcome =
  | { kind: 'found'; result: BookLookupResult }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'hang' }

/**
 * §11: жодного реального HTTP у тестах. Підміняє `BOOK_LOOKUP_PROVIDER` через
 * `overrideProvider` у `createTestApp({ configure })` — сервіс і контролер про
 * підміну не знають.
 *
 * `calls` дає перевірити R3 напряму: попадання в кеш не мусить довести до
 * другого виклику провайдера для того самого ISBN.
 */
export class FakeLookupProvider implements BookLookupProvider {
  private readonly outcomes = new Map<string, Outcome>()
  readonly calls: string[] = []

  respondWith(isbn: string, result: BookLookupResult): void {
    this.outcomes.set(isbn, { kind: 'found', result })
  }

  respondNotFound(isbn: string): void {
    this.outcomes.set(isbn, { kind: 'not-found' })
  }

  respondWithError(isbn: string, message = 'провайдер зламався'): void {
    this.outcomes.set(isbn, { kind: 'error', message })
  }

  /** Ніколи не встигає відповісти — саме так у тесті вивільняється 504. */
  hang(isbn: string): void {
    this.outcomes.set(isbn, { kind: 'hang' })
  }

  lookup(isbn: string, signal: AbortSignal): Promise<BookLookupResult | undefined> {
    this.calls.push(isbn)

    const outcome = this.outcomes.get(isbn)

    if (outcome === undefined || outcome.kind === 'not-found') return Promise.resolve(undefined)
    if (outcome.kind === 'found') return Promise.resolve(outcome.result)
    if (outcome.kind === 'error')
      return Promise.reject(new BookLookupProviderError(outcome.message))

    // 'hang': проміс, який навмисно ніколи сам не встигає — LookupService
    // вичерпує таймаут і скасовує сигнал раніше.
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }

  clear(): void {
    this.outcomes.clear()
    this.calls.length = 0
  }
}
