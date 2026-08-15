import { createTestPrismaClient, truncateAll } from './test-database'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * Перевіряє те, чого немає в Prisma Schema і що тому легко загубити при правках
 * міграцій: розширення §4.9 і три індекси, дописані/спеціалізовані вручну.
 */
describe('обʼєкти схеми поза Prisma Schema', () => {
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

  it('розширення pg_trgm і unaccent створені (§4.9)', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
    `

    expect(rows.map((row) => row.extname).sort()).toEqual(['pg_trgm', 'unaccent'])
  })

  it('GIN-індекси для fuzzy-пошуку існують і використовують gin_trgm_ops', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('work_title_trgm_idx', 'author_name_trgm_idx')
      ORDER BY indexname
    `

    expect(rows).toHaveLength(2)
    expect(rows[0]?.indexdef).toMatch(/USING gin \(name gin_trgm_ops\)/)
    expect(rows[1]?.indexdef).toMatch(/USING gin \("titleNorm" gin_trgm_ops\)/)
  })

  it('similarity() ловить назву з друкарською помилкою (§6.3, крок 2)', async () => {
    const author = await prisma.user.create({
      data: { email: 'trgm@example.com', passwordHash: 'x', displayName: 'Пошук' },
    })

    await prisma.work.create({
      data: {
        title: 'Шантарам',
        titleNorm: 'шантарам',
        origLang: 'en',
        createdById: author.id,
      },
    })

    // Саме той поріг, що в §6.3: без pg_trgm цей запит не виконався б узагалі,
    // а з ним «шантрам» без літери все одно знаходить наявний твір.
    const found = await prisma.$queryRaw<{ title: string }[]>`
      SELECT title FROM "Work" WHERE similarity("titleNorm", 'шантрам') > 0.3
    `

    expect(found).toEqual([{ title: 'Шантарам' }])
  })

  it('one_active_loan_per_copy — унікальний частковий індекс саме на двох статусах (§5.3)', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'one_active_loan_per_copy'
    `

    expect(rows).toHaveLength(1)
    expect(rows[0]?.indexdef).toMatch(/CREATE UNIQUE INDEX/)
    expect(rows[0]?.indexdef).toMatch(/"copyId"/)
    expect(rows[0]?.indexdef).toMatch(/APPROVED/)
    expect(rows[0]?.indexdef).toMatch(/HANDED_OVER/)
  })

  it('CHECK-обмеження Friendship існують (§4.3, §5.3.5)', async () => {
    const rows = await prisma.$queryRaw<{ conname: string; definition: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Friendship"'::regclass AND contype = 'c'
      ORDER BY conname
    `

    expect(rows.map((row) => row.conname)).toEqual([
      'friendship_ab_ordered',
      'friendship_block_author_valid',
    ])

    // Порядок пари — строга нерівність, інакше пара «сам із собою» пройшла б.
    expect(rows[0]?.definition).toMatch(/"userAId" < "userBId"/)

    // Перевірка автора блокування мусить лишатися fail-closed: CASE замість
    // кон'юнкції порівнянь, і явна перевірка належності до пари. Наївне
    // `blockedById IN (userAId, userBId)` для NULL дало б NULL, і рядок без
    // автора мовчки пройшов би — див. коментар у міграції.
    expect(rows[1]?.definition).toMatch(/CASE/)
    expect(rows[1]?.definition).toMatch(/"blockedById" IS NOT NULL/)
    expect(rows[1]?.definition).toMatch(/"blockedById" = "userAId"/)
    expect(rows[1]?.definition).toMatch(/"blockedById" = "userBId"/)
    expect(rows[1]?.definition).toMatch(/"blockedById" IS NULL/)
  })

  it('blockedById має зовнішній ключ на User — від нього залежить право (§6.2)', async () => {
    const rows = await prisma.$queryRaw<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Friendship"'::regclass
        AND contype = 'f'
        AND conname = 'Friendship_blockedById_fkey'
    `

    expect(rows).toHaveLength(1)
    expect(rows[0]?.definition).toMatch(/REFERENCES "User"\(id\)/)
    expect(rows[0]?.definition).toMatch(/ON DELETE CASCADE/)
  })
})
