import { createGraph } from './fixtures'
import { createTestPrismaClient, truncateAll } from './test-database'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * Stage 8e-1 (docs/plan/stage-8-inventory.md, §5/R9): DB-об'єкти навколо
 * `revision`/`createdById`/`position`, які додає обов'язкова "required"
 * міграція (20260910231806_catalog_correction_audit_required) поверх
 * додаткової (20260910231627_catalog_correction_audit_schema).
 *
 * `CatalogRevision`-специфічні перевірки — окремо, у
 * `catalog-revision.db-spec.ts`.
 */
describe('Stage 8e-1: revision/createdById/position — DB-обʼєкти', () => {
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

  it('Translation_createdById_idx існує', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Translation'
    `

    expect(rows.map((row) => row.indexname)).toContain('Translation_createdById_idx')
  })

  it('Work/Translation/Edition.revision — NOT NULL, default 1', async () => {
    const rows = await prisma.$queryRaw<
      { table_name: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT table_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name IN ('Work', 'Translation', 'Edition') AND column_name = 'revision'
      ORDER BY table_name
    `

    expect(rows).toHaveLength(3)

    for (const row of rows) {
      expect(row.is_nullable).toBe('NO')
      expect(row.column_default).toMatch(/^1(::integer)?$/)
    }

    const graph = await createGraph(prisma)

    expect((await prisma.work.findUniqueOrThrow({ where: { id: graph.workId } })).revision).toBe(1)
    expect(
      (await prisma.translation.findUniqueOrThrow({ where: { id: graph.translationId } })).revision,
    ).toBe(1)
    expect(
      (await prisma.edition.findUniqueOrThrow({ where: { id: graph.editionId } })).revision,
    ).toBe(1)
  })

  it('Translation.createdById — NOT NULL після required-міграції (R9)', async () => {
    const [row] = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'Translation' AND column_name = 'createdById'
    `

    expect(row?.is_nullable).toBe('NO')
  })

  it('WorkAuthor.position — NOT NULL після required-міграції (R10a)', async () => {
    const [row] = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'WorkAuthor' AND column_name = 'position'
    `

    expect(row?.is_nullable).toBe('NO')
  })

  it('CatalogEntityType — рівно три значення §3: Work, Translation, Edition', async () => {
    const rows = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = 'public."CatalogEntityType"'::regtype
      ORDER BY enumlabel
    `

    expect(rows.map((row) => row.enumlabel)).toEqual(['EDITION', 'TRANSLATION', 'WORK'])
  })
})
