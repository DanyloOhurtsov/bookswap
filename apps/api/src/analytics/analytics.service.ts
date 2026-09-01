import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { computeDedupeKey } from './dedupe-key'
import {
  PRODUCT_EVENT_TYPE,
  productEventInputSchema,
  type ProductEventInput,
  type ProductEventType,
} from './product-event.types'

/** §2.4: інкремент — лише коли міняється форма `properties` для конкретного `type`. */
const SCHEMA_VERSION = 1

/**
 * Категорія помилки, безпечна для логів: жодних ID, `properties` чи `dedupeKey`
 * (§6 AnalyticsService.record — Logger.warn містить лише event type і категорію).
 * `error.message` навмисно не використовується: для помилок валідації Zod він
 * може містити саме те значення, яке не пройшло перевірку.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.constructor.name

  return 'unknown'
}

/**
 * Безпечна мітка типу події для логів: рівно один із семи §4 або літерал
 * `UNKNOWN`. Вхід сюди — ще НЕвалідований `input.type`, тож звіряється з
 * таксономією, а не логується як є: інакше довільний рядок (умовно, чужий user
 * ID чи секрет, підставлений замість `type`) потрапив би прямо в лог.
 */
function safeEventTypeLabel(candidate: unknown): ProductEventType | 'UNKNOWN' {
  return typeof candidate === 'string' &&
    (PRODUCT_EVENT_TYPE as readonly string[]).includes(candidate)
    ? (candidate as ProductEventType)
    : 'UNKNOWN'
}

/**
 * docs/plan/stage-8-activation.md, §3 — best-effort запис ПІСЛЯ коміту доменної
 * транзакції. Гарантія: збій тут ніколи не змінює результат чи успішність
 * батьківської операції. Це не атомарний запис у тій самій транзакції.
 *
 * Call sites are limited to the after-commit mutation points approved for Stage 8a.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ProductEventInput): Promise<void> {
    try {
      // Один try/catch на валідацію, dedupeKey і Prisma-запис: усі три можуть
      // кинути (Zod, теоретично computeDedupeKey, createMany), і жодна з них не
      // має права вийти з record() — §6 вимагає завжди resolved Promise<void>.
      const { type, subjectUserId, domainEntityId, properties } =
        productEventInputSchema.parse(input)
      const dedupeKey = computeDedupeKey(type, domainEntityId, subjectUserId)

      // `createMany` + `skipDuplicates`, не `create`: повторний виклик із тим самим
      // `dedupeKey` (retry after-commit хука) — очікуваний no-op, не помилка (§6).
      await this.prisma.productEvent.createMany({
        data: [{ type, properties, schemaVersion: SCHEMA_VERSION, dedupeKey, subjectUserId }],
        skipDuplicates: true,
      })
    } catch (error) {
      const label = safeEventTypeLabel((input as { type?: unknown } | null | undefined)?.type)

      this.logger.warn(`Product event запис не вдався (${label}): ${describeFailure(error)}`)
    }
  }
}
