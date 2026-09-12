import { createGraph, createUser } from './fixtures'
import { createTestPrismaClient, truncateAll } from './test-database'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * Stage 8e-1, R9: DB-об'єкти `CatalogRevision`, які не пише жоден код цього
 * підетапу (запис audit — 8e-2), але схема, індекси й FK-поведінка мають бути
 * правильними вже зараз — інакше 8e-2 будує PATCH на непроханій основі.
 *
 * `CatalogRevision` не входить у список `TABLES` (test-database.ts) — так само,
 * як `ProductEvent` (`analytics.db-spec.ts`): `TRUNCATE ... CASCADE` на `User`
 * спорожняє й її автоматично через FK `actorId`, незалежно від того, що вона в
 * списку не названа. Тест нижче це підтверджує.
 */
describe('CatalogRevision (R9)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrismaClient()
  })

  beforeEach(async () => {
    await truncateAll(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('таблиця й обидва індекси існують', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'CatalogRevision'
    `
    const names = indexes.map((index) => index.indexname)

    expect(names).toContain('CatalogRevision_entityType_entityId_createdAt_idx')
    expect(names).toContain('CatalogRevision_actorId_idx')

    const composite = indexes.find(
      (index) => index.indexname === 'CatalogRevision_entityType_entityId_createdAt_idx',
    )

    expect(composite?.indexdef).toMatch(/\("entityType", "entityId", "createdAt"\)/)
  })

  it('actorId — FK на User з ON DELETE SET NULL', async () => {
    const rows = await prisma.$queryRaw<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"CatalogRevision"'::regclass
        AND contype = 'f'
        AND conname = 'CatalogRevision_actorId_fkey'
    `

    expect(rows).toHaveLength(1)
    expect(rows[0]?.definition).toMatch(/REFERENCES "User"\(id\)/)
    expect(rows[0]?.definition).toMatch(/ON DELETE SET NULL/)
  })

  /** R9: «без FK на catalog entity, щоб пережити майбутній merge». */
  it('entityId не має FK — рядок переживає видалення Work, на який посилався', async () => {
    const constraints = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"CatalogRevision"'::regclass AND contype = 'f'
    `

    expect(constraints.map((row) => row.conname)).toEqual(['CatalogRevision_actorId_fkey'])

    const graph = await createGraph(prisma)
    const revision = await prisma.catalogRevision.create({
      data: {
        entityType: 'WORK',
        entityId: graph.workId,
        actorId: graph.ownerId,
        before: { title: 'До' },
        after: { title: 'Після' },
        fromRevision: 1,
        toRevision: 2,
      },
    })

    // Copy заважає видаленню Work (RESTRICT) — прибираємо його так само, як
    // referential-actions.db-spec.ts.
    await prisma.copy.delete({ where: { id: graph.copyId } })
    await prisma.work.delete({ where: { id: graph.workId } })

    const survived = await prisma.catalogRevision.findUniqueOrThrow({
      where: { id: revision.id },
    })

    expect(survived.entityId).toBe(graph.workId)
  })

  it('видалення User встановлює actorId = NULL і не видаляє рядок', async () => {
    const actorId = await createUser(prisma, 'Автор редагування')
    const revision = await prisma.catalogRevision.create({
      data: {
        entityType: 'TRANSLATION',
        entityId: 'translation-x',
        actorId,
        before: { translator: 'Старий' },
        after: { translator: 'Новий' },
        fromRevision: 1,
        toRevision: 2,
      },
    })

    await prisma.user.delete({ where: { id: actorId } })

    const survived = await prisma.catalogRevision.findUniqueOrThrow({
      where: { id: revision.id },
    })

    expect(survived.actorId).toBeNull()
  })

  it('actorId — nullable з самого початку (система, не лише людина, може писати audit)', async () => {
    const revision = await prisma.catalogRevision.create({
      data: {
        entityType: 'EDITION',
        entityId: 'edition-x',
        actorId: null,
        before: { publisher: null },
        after: { publisher: 'КСД' },
        fromRevision: 1,
        toRevision: 2,
      },
    })

    expect(revision.actorId).toBeNull()
  })

  it('before/after — довільний JSON, зберігається і читається без втрат', async () => {
    const before = {
      title: 'Стара назва',
      authors: [{ authorId: 'a-1', name: 'Хтось', role: 'AUTHOR', position: 0 }],
    }
    const after = {
      title: 'Нова назва',
      authors: [{ authorId: 'a-1', name: 'Хтось', role: 'AUTHOR', position: 0 }],
    }

    const revision = await prisma.catalogRevision.create({
      data: {
        entityType: 'WORK',
        entityId: 'work-x',
        actorId: null,
        before,
        after,
        fromRevision: 3,
        toRevision: 4,
      },
    })

    const read = await prisma.catalogRevision.findUniqueOrThrow({ where: { id: revision.id } })

    expect(read.before).toEqual(before)
    expect(read.after).toEqual(after)
  })

  it('truncateAll спорожняє CatalogRevision, хоч її й немає у списку TABLES', async () => {
    const actorId = await createUser(prisma)

    await prisma.catalogRevision.create({
      data: {
        entityType: 'WORK',
        entityId: 'work-y',
        actorId,
        before: {},
        after: {},
        fromRevision: 1,
        toRevision: 2,
      },
    })

    expect(await prisma.catalogRevision.count()).toBe(1)

    await truncateAll(prisma)

    expect(await prisma.catalogRevision.count()).toBe(0)
  })
})
