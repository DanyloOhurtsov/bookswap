import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { WORK_MERGE_ERROR_CODES, WorkMergeError } from './merge-errors'

/** Скільки чого переїхало — це те, що CLI показує оператору. */
export interface MergeSummary {
  sourceWorkId: string
  targetWorkId: string
  translationsMoved: number
  editionsMoved: number
  reviewsMoved: number
  reviewsArchived: number
  wishlistItemsMoved: number
  wishlistDuplicatesRemoved: number
  incomingMergesRepointed: number
}

/**
 * §6.3, «мердж дублікатів», підетап 7g.
 *
 * Об'єднує два `Work`: переносить `Edition`, `Translation`, `Review` і
 * `WishlistItem` на канонічний запис і проставляє `mergedIntoId` на вихідному.
 * Вихідний твір НЕ видаляється — інакше вмирають зовнішні посилання (§6.3), а
 * читання за старим id (підетап 7h) не мало б куди дивитися.
 *
 * Публічного ендпоінта тут немає навмисно: §6.3 називає мерж адмінським
 * скриптом v1, і DoD 7g це закріплює. Єдиний виклик — `src/cli/merge-works.ts`.
 */
@Injectable()
export class MergeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Уся операція — одна транзакція: часткове злиття гірше за нездійснене.
   * Половина видань на новому творі, половина на старому, і вішлист, який уже
   * втратив дублікати, — стан, з якого немає автоматичного виходу.
   */
  async merge(sourceWorkId: string, targetWorkId: string): Promise<MergeSummary> {
    if (sourceWorkId === targetWorkId) {
      throw new WorkMergeError(
        WORK_MERGE_ERROR_CODES.WORK_MERGE_SELF,
        'Вихідний і цільовий твір збігаються',
      )
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockWorks(tx, sourceWorkId, targetWorkId)
      await this.assertMergeable(tx, sourceWorkId, targetWorkId)

      // Конфлікти розв'язуються ДО переносу: інакше перенос рецензій нижче
      // вдариться в `one_active_review_per_work_user` і покладе транзакцію
      // замість того, щоб застосувати R5.
      const reviewsArchived = await this.archiveLosingReviews(tx, sourceWorkId, targetWorkId)
      const wishlistDuplicatesRemoved = await this.dropLosingWishlistItems(
        tx,
        sourceWorkId,
        targetWorkId,
      )

      const onSource = { where: { workId: sourceWorkId }, data: { workId: targetWorkId } }

      const translations = await tx.translation.updateMany(onSource)
      // `Copy` і `Loan` переносити не треба: вони висять на `Edition`, який щойно
      // переїхав, і ланцюг §3 Work → Translation → Edition → Copy лишається цілим.
      const editions = await tx.edition.updateMany(onSource)
      const reviews = await moveReviews(tx, sourceWorkId, targetWorkId)
      const wishlistItems = await tx.wishlistItem.updateMany(onSource)

      // R4, глибина розв'язання рівно 1: усе, що вказувало на вихідний твір,
      // має тепер вказувати на цільовий. Без цього рядка `merge(A→B)`, а потім
      // `merge(B→C)` залишили б ланцюг A→B→C, і 7h довелося б ходити по ньому
      // циклом.
      const repointed = await tx.work.updateMany({
        where: { mergedIntoId: sourceWorkId },
        data: { mergedIntoId: targetWorkId },
      })

      await tx.work.update({
        where: { id: sourceWorkId },
        data: { mergedIntoId: targetWorkId },
      })

      return {
        sourceWorkId,
        targetWorkId,
        translationsMoved: translations.count,
        editionsMoved: editions.count,
        reviewsMoved: reviews,
        reviewsArchived,
        wishlistItemsMoved: wishlistItems.count,
        wishlistDuplicatesRemoved,
        incomingMergesRepointed: repointed.count,
      }
    })
  }

  /**
   * Блокування обох творів і всіх, що вже злиті у вихідний.
   *
   * `ORDER BY "id"` — проти дедлоку: два паралельні мержі з перетином беруть
   * рядки в тому самому порядку (той самий прийом, що `lockCopy` у
   * `LoanService`).
   *
   * Знімок бачить лише ті вхідні мержі, які існують на момент блокування, — і
   * цього досить. Щоб вхідний мерж з'явився пізніше, конкурентна транзакція
   * мусила б сама проставити `mergedIntoId = source`, а для цього — заблокувати
   * той самий рядок `source` цим же запитом, тобто стати в чергу за нами. Коли
   * вона його дочекається, у `source` уже стоятиме власний `mergedIntoId`, і
   * `assertMergeable` відхилить її як мерж із неканонічного твору.
   */
  private async lockWorks(
    tx: TransactionClient,
    sourceWorkId: string,
    targetWorkId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "Work"
      WHERE "id" IN (${sourceWorkId}, ${targetWorkId}) OR "mergedIntoId" = ${sourceWorkId}
      ORDER BY "id"
      FOR UPDATE
    `
  }

  /**
   * Обидва твори мусять бути канонічними, і це два різні правила.
   *
   * Канонічний **source** відхиляє повторний мерж тієї самої пари й не дає
   * злити A у C, коли A уже в B, — з обох виріс би ланцюг. Канонічний **target**
   * — це буквально R4: мерж у вже змержений запис. Ним же відхиляється пряма
   * спроба циклу `A→B`, потім `B→A`.
   */
  private async assertMergeable(
    tx: TransactionClient,
    sourceWorkId: string,
    targetWorkId: string,
  ): Promise<void> {
    const source = await tx.work.findUnique({
      where: { id: sourceWorkId },
      select: { mergedIntoId: true },
    })
    const target = await tx.work.findUnique({
      where: { id: targetWorkId },
      select: { mergedIntoId: true },
    })

    if (source === null || target === null) {
      const missing = source === null ? sourceWorkId : targetWorkId

      throw new WorkMergeError(
        WORK_MERGE_ERROR_CODES.WORK_MERGE_WORK_NOT_FOUND,
        `Твору ${missing} не існує`,
      )
    }

    if (source.mergedIntoId !== null) {
      throw new WorkMergeError(
        WORK_MERGE_ERROR_CODES.WORK_MERGE_SOURCE_ALREADY_MERGED,
        `Вихідний твір уже змержено у ${source.mergedIntoId}`,
      )
    }

    if (target.mergedIntoId !== null) {
      throw new WorkMergeError(
        WORK_MERGE_ERROR_CODES.WORK_MERGE_TARGET_ALREADY_MERGED,
        `Цільовий твір сам змержено у ${target.mergedIntoId} — мержити треба туди`,
      )
    }
  }

  /**
   * R5: та сама людина оцінила обидва дублікати.
   *
   * Активною лишається рецензія з новішим `updatedAt`; програшна отримує
   * `archivedAt` і `archivedByMergeSourceId`, тобто випадає з-під часткового
   * унікального індексу, не зникаючи з бази.
   *
   * Вторинний критерій при РІВНИХ `updatedAt` — сторона: виграє рецензія
   * цільового твору. Він потрібен явно, бо `updatedAt` цілком може збігтися
   * (обидві рецензії створені одним скриптом чи в одну мілісекунду), а
   * покладатися на порядок рядків у вибірці не можна — PostgreSQL його не
   * обіцяє. Саме це й робить `>` нижче: при рівності умова хибна, програє
   * вихідна сторона.
   *
   * Запис — сирим SQL з тієї ж причини, що й у `moveReviews`: `updateMany`
   * переставив би `updatedAt` архівованій рецензії, і рядок вдавав би щойно
   * відредагований.
   */
  private async archiveLosingReviews(
    tx: TransactionClient,
    sourceWorkId: string,
    targetWorkId: string,
  ): Promise<number> {
    const active = await tx.review.findMany({
      where: { workId: { in: [sourceWorkId, targetWorkId] }, archivedAt: null },
      select: { id: true, userId: true, workId: true, updatedAt: true },
    })

    const losers = pairUpByUser(active, sourceWorkId).map(({ source, target }) =>
      source.updatedAt > target.updatedAt ? target.id : source.id,
    )

    if (losers.length === 0) return 0

    return tx.$executeRaw`
      UPDATE "Review"
      SET "archivedAt" = NOW(), "archivedByMergeSourceId" = ${sourceWorkId}
      WHERE "id" = ANY(${losers})
    `
  }

  /**
   * R6: та сама людина додала обидва дублікати у вішлист.
   *
   * На відміну від рецензії, корисного вмісту в рядку немає — лишається ранішій
   * за `createdAt`, другий видаляється. Вторинний критерій при РІВНИХ
   * `createdAt` — той самий, що й для рецензій: виграє рядок цільового твору
   * (при рівності `<` хибне, тож програє вихідна сторона).
   */
  private async dropLosingWishlistItems(
    tx: TransactionClient,
    sourceWorkId: string,
    targetWorkId: string,
  ): Promise<number> {
    const items = await tx.wishlistItem.findMany({
      where: { workId: { in: [sourceWorkId, targetWorkId] } },
      select: { id: true, userId: true, workId: true, createdAt: true },
    })

    const losers = pairUpByUser(items, sourceWorkId).map(({ source, target }) =>
      source.createdAt < target.createdAt ? target.id : source.id,
    )

    if (losers.length === 0) return 0

    const removed = await tx.wishlistItem.deleteMany({ where: { id: { in: losers } } })

    return removed.count
  }
}

/**
 * Прив'язка клієнта транзакції. Перелік звужений навмисно: він показує, до чого
 * мерж має право торкатися. `Copy` і `Loan` тут немає — і не має бути.
 */
type TransactionClient = Pick<
  PrismaService,
  'work' | 'translation' | 'edition' | 'review' | 'wishlistItem' | '$queryRaw' | '$executeRaw'
>

/**
 * Перенос рецензій на канонічний твір — сирим SQL, а не `updateMany`.
 *
 * Причина одна й вагома: `Review.updatedAt` має `@updatedAt`, і будь-який
 * `updateMany` переставив би його на «зараз» усім перенесеним рядкам. Це не
 * косметика — саме `updatedAt` вирішує R5. Після бампу наступний мерж обирав би
 * активну рецензію не за тим, коли людина її редагувала, а за тим, кого
 * останнім зачепила попередня адмінська операція. Мерж не є редагуванням
 * відгуку й не має вдавати його.
 *
 * Переносяться ВСІ рецензії, включно з архівними: архівна могла приїхати з
 * попереднього мержу, і лишити її на неканонічному творі означало б, що читання
 * канонічного твору (підетап 7h) її більше не побачить.
 */
async function moveReviews(
  tx: TransactionClient,
  sourceWorkId: string,
  targetWorkId: string,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Review" SET "workId" = ${targetWorkId} WHERE "workId" = ${sourceWorkId}
  `
}

interface SidedRows<T> {
  source: T
  target: T
}

/**
 * Рядки того самого користувача, що є на ОБОХ творах.
 *
 * Другої сторони немає — конфлікту немає, рядок просто переїде разом з усіма.
 * Спільна для рецензій і вішлиста, бо обидві таблиці конфліктують однаково: за
 * парою (користувач, твір).
 */
function pairUpByUser<T extends { userId: string; workId: string }>(
  rows: T[],
  sourceWorkId: string,
): SidedRows<T>[] {
  const onSource = new Map<string, T>()
  const onTarget = new Map<string, T>()

  for (const row of rows) {
    if (row.workId === sourceWorkId) onSource.set(row.userId, row)
    else onTarget.set(row.userId, row)
  }

  const pairs: SidedRows<T>[] = []

  for (const [userId, source] of onSource) {
    const target = onTarget.get(userId)

    if (target !== undefined) pairs.push({ source, target })
  }

  return pairs
}
