import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { INestApplicationContext } from '@nestjs/common'
import { MergeCliModule } from '../src/cli/merge-cli.module'
import { WORK_MERGE_ERROR_CODES, WorkMergeError } from '../src/catalog/merge/merge-errors'
import { MergeService } from '../src/catalog/merge/merge.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { createGraph, createUser } from './db/fixtures'
import type { WorkMergeErrorCode } from '../src/catalog/merge/merge-errors'

/**
 * §6.3 «мердж дублікатів», підетап 7g.
 *
 * Піднімається САМЕ `MergeCliModule` — той самий модуль, що й у
 * `src/cli/merge-works.ts`. Так перевіряється не лише логіка сервісу, а й те, що
 * адмінська команда взагалі збирається: якщо DI розсиплеться, ляже цей файл, а
 * не оператор посеред злиття.
 *
 * ВАЖЛИВО про ізоляцію: e2e-файли ділять одну тестову базу й нічого не чистять
 * між тестами (див. `friends.e2e-spec.ts`). Кожна перевірка звужена за id творів.
 */
describe('Мерж творів (e2e)', () => {
  let context: INestApplicationContext
  let prisma: PrismaService
  let merge: MergeService

  beforeAll(async () => {
    // Скомпільований `TestingModule` сам є контекстом застосунку — HTTP-шар тут
    // ні до чого. `init()` потрібен явно: без нього не спрацює `onModuleInit`
    // у `PrismaService`, а `close()` не закриє підключення.
    context = await Test.createTestingModule({ imports: [MergeCliModule] }).compile()
    await context.init()

    prisma = context.get(PrismaService)
    merge = context.get(MergeService)
  })

  afterAll(async () => {
    await context.close()
  })

  /** Два незалежні повні ланцюги §3 на одного власника. */
  async function twoWorks(): Promise<{ source: string; target: string; ownerId: string }> {
    const ownerId = await createUser(prisma, 'Адмін мержу')
    const source = await createGraph(prisma, { ownerId })
    const target = await createGraph(prisma, { ownerId })

    return { source: source.workId, target: target.workId, ownerId }
  }

  async function bareWork(createdById: string): Promise<string> {
    const work = await prisma.work.create({
      data: { title: 'Дублікат', titleNorm: 'дублікат', origLang: 'uk', createdById },
    })

    return work.id
  }

  /**
   * `updatedAt` задається явно: тай-брейк R5 порівнює саме його, а два рядки,
   * створені підряд, отримали б значення, що відрізняються на випадкові
   * мілісекунди — тест був би нестабільним.
   */
  async function createReview(
    workId: string,
    userId: string,
    updatedAt: Date,
    text: string,
  ): Promise<string> {
    const review = await prisma.review.create({
      data: { workId, userId, rating: 5, text, updatedAt },
    })

    return review.id
  }

  async function expectRefusal(promise: Promise<unknown>, code: WorkMergeErrorCode): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(WorkMergeError)
    await expect(promise).rejects.toMatchObject({ code })
  }

  it('переносить увесь ланцюг і лишає вихідний твір живим', async () => {
    const { source, target, ownerId } = await twoWorks()
    const reader = await createUser(prisma, 'Читач')

    await prisma.wishlistItem.create({ data: { userId: reader, workId: source } })
    await createReview(source, reader, new Date('2026-01-01T00:00:00Z'), 'Відгук з дубліката')

    const sourceCopyIds = (
      await prisma.copy.findMany({
        where: { edition: { workId: source } },
        select: { id: true },
      })
    ).map((copy) => copy.id)

    const summary = await merge.merge(source, target)

    expect(summary).toMatchObject({
      sourceWorkId: source,
      targetWorkId: target,
      translationsMoved: 1,
      editionsMoved: 1,
      reviewsMoved: 1,
      reviewsArchived: 0,
      wishlistItemsMoved: 1,
      wishlistDuplicatesRemoved: 0,
      incomingMergesRepointed: 0,
    })

    await expect(prisma.translation.count({ where: { workId: source } })).resolves.toBe(0)
    await expect(prisma.edition.count({ where: { workId: source } })).resolves.toBe(0)
    await expect(prisma.review.count({ where: { workId: source } })).resolves.toBe(0)
    await expect(prisma.wishlistItem.count({ where: { workId: source } })).resolves.toBe(0)

    await expect(prisma.translation.count({ where: { workId: target } })).resolves.toBe(2)
    await expect(prisma.edition.count({ where: { workId: target } })).resolves.toBe(2)
    await expect(prisma.review.count({ where: { workId: target } })).resolves.toBe(1)
    await expect(prisma.wishlistItem.count({ where: { workId: target } })).resolves.toBe(1)

    // §3: `Copy` висить на `Edition`, тож переїжджає разом із ним, а не окремо.
    await expect(
      prisma.copy.count({ where: { id: { in: sourceCopyIds }, edition: { workId: target } } }),
    ).resolves.toBe(sourceCopyIds.length)

    // §6.3: старий запис не видаляється — інакше вмирають зовнішні посилання.
    await expect(
      prisma.work.findUnique({ where: { id: source }, select: { mergedIntoId: true } }),
    ).resolves.toEqual({ mergedIntoId: target })

    expect(ownerId).toBeDefined()
  })

  it('R5: конфліктні рецензії — жоден рядок не зникає, активною лишається новіша', async () => {
    const { source, target } = await twoWorks()
    const reader = await createUser(prisma, 'Подвійний рецензент')

    const older = await createReview(source, reader, new Date('2026-01-01T00:00:00Z'), 'Старіший')
    const newer = await createReview(target, reader, new Date('2026-02-01T00:00:00Z'), 'Новіший')

    const before = await prisma.review.count({ where: { userId: reader } })

    const summary = await merge.merge(source, target)

    expect(summary.reviewsArchived).toBe(1)

    // DoD: тест рахує кількість рецензій до і після.
    await expect(prisma.review.count({ where: { userId: reader } })).resolves.toBe(before)
    expect(before).toBe(2)

    const rows = await prisma.review.findMany({
      where: { userId: reader },
      select: {
        id: true,
        workId: true,
        text: true,
        archivedAt: true,
        archivedByMergeSourceId: true,
      },
    })

    // Обидві опинилися на канонічному творі — архівна теж, інакше 7h її не побачить.
    expect(rows.every((row) => row.workId === target)).toBe(true)

    const active = rows.filter((row) => row.archivedAt === null)
    const archived = rows.filter((row) => row.archivedAt !== null)

    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe(newer)
    expect(archived).toHaveLength(1)
    expect(archived[0]?.id).toBe(older)
    expect(archived[0]?.text).toBe('Старіший')
    expect(archived[0]?.archivedByMergeSourceId).toBe(source)
  })

  it('R5: мерж не вдає редагування — `updatedAt` перенесених рецензій не зсувається', async () => {
    const { source, target } = await twoWorks()
    const reader = await createUser(prisma, 'Рецензент без конфлікту')
    const stamp = new Date('2026-03-04T05:06:07.000Z')

    const id = await createReview(source, reader, stamp, 'Без конфлікту')

    await merge.merge(source, target)

    // Якби перенос ішов через `updateMany`, `@updatedAt` переставив би цей рядок
    // на «зараз» — і наступний мерж обрав би активну рецензію за адмінською
    // операцією, а не за тим, коли людина її редагувала.
    await expect(
      prisma.review.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } }),
    ).resolves.toEqual({ updatedAt: stamp })
  })

  it('R6: конфліктний вішлист — лишається ранішій, дублікат видаляється', async () => {
    const { source, target } = await twoWorks()
    const eager = await createUser(prisma, 'Хоче обидва')
    const single = await createUser(prisma, 'Хоче один')

    await prisma.wishlistItem.create({
      data: { userId: eager, workId: source, createdAt: new Date('2026-01-01T00:00:00Z') },
    })
    await prisma.wishlistItem.create({
      data: { userId: eager, workId: target, createdAt: new Date('2026-02-01T00:00:00Z') },
    })
    await prisma.wishlistItem.create({ data: { userId: single, workId: source } })

    const summary = await merge.merge(source, target)

    expect(summary.wishlistDuplicatesRemoved).toBe(1)

    const kept = await prisma.wishlistItem.findMany({
      where: { userId: eager },
      select: { workId: true, createdAt: true },
    })

    expect(kept).toEqual([{ workId: target, createdAt: new Date('2026-01-01T00:00:00Z') }])

    // Той, у кого конфлікту не було, просто переїхав.
    await expect(
      prisma.wishlistItem.count({ where: { userId: single, workId: target } }),
    ).resolves.toBe(1)
  })

  it('повторний мерж тієї самої пари відхиляється', async () => {
    const { source, target } = await twoWorks()

    await merge.merge(source, target)

    await expectRefusal(
      merge.merge(source, target),
      WORK_MERGE_ERROR_CODES.WORK_MERGE_SOURCE_ALREADY_MERGED,
    )
  })

  it('мерж уже змерженого твору кудись іще відхиляється — інакше виріс би ланцюг', async () => {
    const { source, target, ownerId } = await twoWorks()
    const third = await bareWork(ownerId)

    await merge.merge(source, target)

    await expectRefusal(
      merge.merge(source, third),
      WORK_MERGE_ERROR_CODES.WORK_MERGE_SOURCE_ALREADY_MERGED,
    )
  })

  it('мерж твору сам у себе відхиляється', async () => {
    const { source } = await twoWorks()

    await expectRefusal(merge.merge(source, source), WORK_MERGE_ERROR_CODES.WORK_MERGE_SELF)
  })

  it('R4: мерж у вже змержений твір відхиляється', async () => {
    const { source, target, ownerId } = await twoWorks()
    const third = await bareWork(ownerId)

    await merge.merge(source, target)

    await expectRefusal(
      merge.merge(third, source),
      WORK_MERGE_ERROR_CODES.WORK_MERGE_TARGET_ALREADY_MERGED,
    )
  })

  it('пряма спроба циклу A→B, потім B→A відхиляється', async () => {
    const { source: a, target: b } = await twoWorks()

    await merge.merge(a, b)

    await expectRefusal(merge.merge(b, a), WORK_MERGE_ERROR_CODES.WORK_MERGE_TARGET_ALREADY_MERGED)
  })

  it('R4: глибина розвʼязання лишається 1 — вхідні мержі переїжджають на нову ціль', async () => {
    const { source: a, target: b, ownerId } = await twoWorks()
    const c = await bareWork(ownerId)

    await merge.merge(a, b)

    const summary = await merge.merge(b, c)

    expect(summary.incomingMergesRepointed).toBe(1)

    // Ланцюга A→B→C не існує: A вказує одразу на C.
    const rows = await prisma.work.findMany({
      where: { id: { in: [a, b] } },
      select: { id: true, mergedIntoId: true },
      orderBy: { id: 'asc' },
    })

    expect(rows.every((row) => row.mergedIntoId === c)).toBe(true)

    // Канонічний твір не вказує нікуди — саме він і є кінцем розвʼязання.
    await expect(
      prisma.work.findUnique({ where: { id: c }, select: { mergedIntoId: true } }),
    ).resolves.toEqual({ mergedIntoId: null })
  })

  it('неіснуючий твір відхиляється окремим кодом', async () => {
    const { source } = await twoWorks()

    await expectRefusal(
      merge.merge(source, 'work-that-never-was'),
      WORK_MERGE_ERROR_CODES.WORK_MERGE_WORK_NOT_FOUND,
    )
    await expectRefusal(
      merge.merge('work-that-never-was', source),
      WORK_MERGE_ERROR_CODES.WORK_MERGE_WORK_NOT_FOUND,
    )
  })
})
