import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { API_ERROR_CODES, bookLookupResultSchema, type BookLookupResult } from '@bookswap/shared'
import { ApiException } from '../../common/api.exception'
import { PrismaService } from '../../prisma/prisma.service'
import {
  BOOK_LOOKUP_PROVIDER,
  BookLookupProviderError,
  type BookLookupProvider,
} from './book-lookup-provider'
import { lookupCacheTtlMs, lookupTimeoutMs } from './lookup.config'

/** Внутрішній маркер: race програно таймауту, а не провайдеру. */
class LookupTimeoutError extends Error {}

/**
 * §6.3, крок 1 і R3: кеш + оркестрація зовнішнього провайдера.
 *
 * Валідація формату ISBN сюди не потрапляє: за DoD 7b невалідний ISBN мусить
 * дати 400 ДО будь-якого зовнішнього виклику, а це вже робить
 * `LookupQueryDto` (`class-validator`) на вході в контролер.
 */
@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BOOK_LOOKUP_PROVIDER) private readonly provider: BookLookupProvider,
  ) {}

  async lookup(isbn: string): Promise<BookLookupResult> {
    const cached = await this.readCache(isbn)
    if (cached !== undefined) return cached

    const result = await this.fetchFromProvider(isbn)

    await this.writeCache(isbn, result)

    return result
  }

  /**
   * R3: попадання в кеш не витрачає ліміт зовнішнього провайдера.
   *
   * `safeParse`, не `parse`: рядок у `ExternalBookLookup` пережив запис однієї
   * версії схеми — контракт (наприклад, звуження `language` до
   * `languageCodeSchema`, cleanup Stage 7) може зміцніти пізніше. Історія
   * цього конкретного поля доводить, що жоден наявний виробник payload
   * (`OpenLibraryLookupProvider`) ніколи не писав невалідного значення (див.
   * `lookup.service.spec.ts`), але саме сховище — не той рівень, де варто
   * покладатись на це назавжди: рядок, що не проходить актуальну схему,
   * трактується як cache miss — сервіс іде до провайдера й перезаписує кеш
   * свіжим, валідним значенням, а не валить увесь запит 500-ю чи мовчки
   * підміняє поле (`.catch({})` тут навмисно не використовується — саме це
   * ховало б проблему, а не лікувало).
   */
  private async readCache(isbn: string): Promise<BookLookupResult | undefined> {
    const row = await this.prisma.externalBookLookup.findUnique({ where: { isbn } })

    if (row === null) return undefined
    if (Date.now() - row.fetchedAt.getTime() > lookupCacheTtlMs()) return undefined

    const parsed = bookLookupResultSchema.safeParse(row.payload)

    if (!parsed.success) {
      this.logger.warn(
        `Кешований запис ExternalBookLookup(${isbn}) не пройшов схему — трактую як cache miss`,
      )
      return undefined
    }

    return parsed.data
  }

  private async writeCache(isbn: string, payload: BookLookupResult): Promise<void> {
    await this.prisma.externalBookLookup.upsert({
      where: { isbn },
      create: { isbn, payload },
      update: { payload, fetchedAt: new Date() },
    })
  }

  /**
   * Таймаут рахується тут, а не всередині провайдера: незалежно від того, чи
   * реалізація поважає `AbortSignal`, виклик сервісу все одно повертається за
   * `lookupTimeoutMs()`. `signal` передається провайдеру як добра практика —
   * реальний HTTP-провайдер нею скасовує вже непотрібний запит, — але
   * гарантію дає саме `Promise.race`.
   */
  private async fetchFromProvider(isbn: string): Promise<BookLookupResult> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Порядок важливий: `reject` мусить виграти гонку з `providerCall`,
        // тому таймаут-проміс відхиляється ДО `controller.abort()` — інакше
        // скасування синхронно відхилило б `providerCall` (напр. фейковий
        // провайдер, що слухає `abort`) раніше за сам таймаут, і сервіс
        // помилково доповів би `CATALOG_LOOKUP_PROVIDER_ERROR` замість
        // `CATALOG_LOOKUP_TIMEOUT`.
        reject(new LookupTimeoutError())
        controller.abort()
      }, lookupTimeoutMs())
    })

    const providerCall = this.provider.lookup(isbn, controller.signal)
    // Програна гонка не скасовує проміс провайдера: без цього пізнє
    // відхилення (напр. AbortError від fetch) стало б unhandled rejection.
    void providerCall.catch(() => undefined)

    try {
      const found = await Promise.race([providerCall, timeout])

      if (found === undefined) {
        throw new ApiException(
          API_ERROR_CODES.CATALOG_LOOKUP_NOT_FOUND,
          `Зовнішній провайдер не знає ISBN ${isbn}`,
          HttpStatus.NOT_FOUND,
        )
      }

      return found
    } catch (error) {
      if (error instanceof ApiException) throw error

      if (error instanceof LookupTimeoutError) {
        throw new ApiException(
          API_ERROR_CODES.CATALOG_LOOKUP_TIMEOUT,
          'Зовнішній провайдер не відповів вчасно',
          HttpStatus.GATEWAY_TIMEOUT,
        )
      }

      const description = error instanceof BookLookupProviderError ? error.message : String(error)

      throw new ApiException(
        API_ERROR_CODES.CATALOG_LOOKUP_PROVIDER_ERROR,
        `Зовнішній провайдер повернув помилку: ${description}`,
        HttpStatus.BAD_GATEWAY,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
