import { createTestPrismaClient, truncateAll } from './test-database'
import { seed } from '../../prisma/seed'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * Seed мусить бути повторюваним: `prisma migrate reset` виконує його автоматично,
 * а розробник запускає `db:seed` руками. Якщо повторний прогін плодить рядки,
 * локальна база розходиться з тим, що бачать тести й CI.
 */
describe('seed', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = createTestPrismaClient()
    await truncateAll(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function counts(): Promise<Record<string, number>> {
    return {
      users: await prisma.user.count(),
      friendships: await prisma.friendship.count(),
      authors: await prisma.author.count(),
      workAuthors: await prisma.workAuthor.count(),
      works: await prisma.work.count(),
      translations: await prisma.translation.count(),
      editions: await prisma.edition.count(),
      copies: await prisma.copy.count(),
    }
  }

  it('створює зв’язний граф Work → Translation → Edition → Copy', async () => {
    await seed(prisma)

    expect(await counts()).toEqual({
      users: 4,
      friendships: 3,
      authors: 3,
      workAuthors: 3,
      works: 3,
      translations: 3,
      editions: 4,
      copies: 5,
    })
  })

  it('повторний прогін не змінює дані', async () => {
    const before = await counts()
    await seed(prisma)

    expect(await counts()).toEqual(before)
  })

  it('дотримує інваріант §5.3.5: userAId < userBId', async () => {
    const friendships = await prisma.friendship.findMany()

    expect(friendships).not.toHaveLength(0)
    for (const friendship of friendships) {
      expect(friendship.userAId < friendship.userBId).toBe(true)
    }
  })

  it('усі примірники вдома: currentHolderId = ownerId (§5.3.2)', async () => {
    const copies = await prisma.copy.findMany()

    expect(copies).not.toHaveLength(0)
    for (const copy of copies) {
      expect(copy.currentHolderId).toBe(copy.ownerId)
    }
  })

  it('лоанів не створює — це етап 2', async () => {
    expect(await prisma.loan.count()).toBe(0)
  })

  it('кілька примірників одного видання — це кілька рядків Copy, а не quantity (§3)', async () => {
    const grouped = await prisma.copy.groupBy({
      by: ['editionId'],
      _count: { _all: true },
    })

    expect(grouped.some((group) => group._count._all > 1)).toBe(true)
  })
})
