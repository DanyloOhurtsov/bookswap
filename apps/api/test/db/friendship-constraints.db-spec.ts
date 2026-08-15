import { FriendshipStatus } from '../../src/generated/prisma/enums'
import { createUser, expectRejection } from './fixtures'
import { createTestPrismaClient, truncateAll } from './test-database'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * CHECK-обмеження `Friendship`, дописані руками в міграцію
 * `20260815185231_friendship_block_author`.
 *
 * Ці інваріанти тримає й код (`normalizePair`, стейт-машина переходів), і база.
 * Дублювання навмисне: код захищає від помилки в запиті, база — від запиту в обхід
 * коду, тобто від міграції, скрипта чи seed'а, який колись напишуть похапцем.
 */
describe('Обмеження цілісності Friendship', () => {
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

  /** Два користувачі, впорядковані за id — рівно так, як вимагає §5.3.5. */
  async function orderedUsers(): Promise<{ lowId: string; highId: string }> {
    const [lowId, highId] = [await createUser(prisma), await createUser(prisma)].sort()

    if (lowId === undefined || highId === undefined) throw new Error('Недосяжно')

    return { lowId, highId }
  }

  describe('friendship_ab_ordered (інваріант §5.3.5)', () => {
    it('відхиляє пару з переставленими місцями id', async () => {
      const { lowId, highId } = await orderedUsers()

      await expectRejection(
        prisma.friendship.create({
          // Навмисно навпаки: userAId має бути лексикографічно меншим.
          data: { userAId: highId, userBId: lowId, requestedById: highId },
        }),
        /friendship_ab_ordered|check constraint/i,
      )
    })

    it('приймає впорядковану пару', async () => {
      const { lowId, highId } = await orderedUsers()

      const friendship = await prisma.friendship.create({
        data: { userAId: lowId, userBId: highId, requestedById: highId },
      })

      // Ініціатором тут є «більший» id — порядок A/B від цього не залежить (§4.3).
      expect(friendship.userAId).toBe(lowId)
      expect(friendship.requestedById).toBe(highId)
    })

    it('відхиляє пару із самим собою — рівні id не задовольняють строгу нерівність', async () => {
      const userId = await createUser(prisma)

      await expectRejection(
        prisma.friendship.create({
          data: { userAId: userId, userBId: userId, requestedById: userId },
        }),
        /friendship_ab_ordered|check constraint/i,
      )
    })
  })

  describe('friendship_block_author_valid', () => {
    const violation = /friendship_block_author_valid|check constraint/i

    it('відхиляє BLOCKED без автора блокування', async () => {
      const { lowId, highId } = await orderedUsers()

      await expectRejection(
        prisma.friendship.create({
          data: {
            userAId: lowId,
            userBId: highId,
            requestedById: lowId,
            status: FriendshipStatus.BLOCKED,
            blockedById: null,
          },
        }),
        violation,
      )
    })

    it('відхиляє BLOCKED із автором, який не належить до пари', async () => {
      const { lowId, highId } = await orderedUsers()
      // Сторонній існує в базі — тобто зовнішній ключ його пропускає, і рядок
      // тримає саме CHECK. Без нього право знімати блок дісталося б чужому.
      const outsiderId = await createUser(prisma, 'Сторонній')

      await expectRejection(
        prisma.friendship.create({
          data: {
            userAId: lowId,
            userBId: highId,
            requestedById: lowId,
            status: FriendshipStatus.BLOCKED,
            blockedById: outsiderId,
          },
        }),
        violation,
      )
    })

    it('відхиляє BLOCKED із неіснуючим автором', async () => {
      const { lowId, highId } = await orderedUsers()

      // Спрацьовує CHECK, а не зовнішній ключ, і це не помилка тесту: PostgreSQL
      // перевіряє табличні CHECK'и під час вставки кортежу, а FK — тригером після
      // неї. Неіснуючий id завідомо не дорівнює ні userAId, ні userBId, тож умова
      // належності до пари відсікає рядок раніше.
      //
      // Тобто для `blockedById` FK недосяжний як ОКРЕМА причина відмови — його
      // цінність у каскаді при видаленні користувача (перевіряється нижче) і в
      // тому, що право не висить на неперевіреному рядку. Рядок відхилено — а це
      // те, що тут потрібно.
      await expectRejection(
        prisma.friendship.create({
          data: {
            userAId: lowId,
            userBId: highId,
            requestedById: lowId,
            status: FriendshipStatus.BLOCKED,
            blockedById: 'ckl0000000000000000000000',
          },
        }),
        /friendship_block_author_valid|Foreign key constraint/i,
      )
    })

    it.each([FriendshipStatus.PENDING, FriendshipStatus.ACCEPTED, FriendshipStatus.DECLINED])(
      'відхиляє blockedById у стані %s',
      async (status) => {
        const { lowId, highId } = await orderedUsers()

        await expectRejection(
          prisma.friendship.create({
            data: {
              userAId: lowId,
              userBId: highId,
              requestedById: lowId,
              status,
              blockedById: lowId,
            },
          }),
          violation,
        )
      },
    )

    it.each([
      ['userAId', true],
      ['userBId', false],
    ])('приймає BLOCKED з автором-%s', async (_name, byLow) => {
      const { lowId, highId } = await orderedUsers()
      const blockedById = byLow ? lowId : highId

      const friendship = await prisma.friendship.create({
        data: {
          userAId: lowId,
          userBId: highId,
          requestedById: lowId,
          status: FriendshipStatus.BLOCKED,
          blockedById,
        },
      })

      expect(friendship.blockedById).toBe(blockedById)
    })

    it('приймає не-BLOCKED без автора', async () => {
      const { lowId, highId } = await orderedUsers()

      const friendship = await prisma.friendship.create({
        data: { userAId: lowId, userBId: highId, requestedById: lowId },
      })

      expect(friendship.status).toBe(FriendshipStatus.PENDING)
      expect(friendship.blockedById).toBeNull()
    })

    it('не дає зняти статус BLOCKED, лишивши автора', async () => {
      const { lowId, highId } = await orderedUsers()

      const friendship = await prisma.friendship.create({
        data: {
          userAId: lowId,
          userBId: highId,
          requestedById: lowId,
          status: FriendshipStatus.BLOCKED,
          blockedById: lowId,
        },
      })

      // Пастка для наступного етапу: якщо колись зʼявиться перехід BLOCKED → інший
      // статус, він зобовʼязаний занулити blockedById — інакше впаде саме тут.
      await expectRejection(
        prisma.friendship.update({
          where: { id: friendship.id },
          data: { status: FriendshipStatus.ACCEPTED },
        }),
        violation,
      )
    })

    it('не дає прибрати автора, лишивши статус BLOCKED', async () => {
      const { lowId, highId } = await orderedUsers()

      const friendship = await prisma.friendship.create({
        data: {
          userAId: lowId,
          userBId: highId,
          requestedById: lowId,
          status: FriendshipStatus.BLOCKED,
          blockedById: lowId,
        },
      })

      await expectRejection(
        prisma.friendship.update({ where: { id: friendship.id }, data: { blockedById: null } }),
        violation,
      )
    })

    it('видалення автора блокування прибирає рядок каскадом', async () => {
      const { lowId, highId } = await orderedUsers()

      await prisma.friendship.create({
        data: {
          userAId: lowId,
          userBId: highId,
          requestedById: lowId,
          status: FriendshipStatus.BLOCKED,
          blockedById: highId,
        },
      })

      // Каскад іде і через userB, і через blockedById — рядок не має шансу
      // пережити свого автора з висячим посиланням.
      await prisma.user.delete({ where: { id: highId } })

      expect(await prisma.friendship.count({ where: { userAId: lowId } })).toBe(0)
    })
  })

  it('пара лишається унікальною (§4.3: один рядок на пару)', async () => {
    const { lowId, highId } = await orderedUsers()

    await prisma.friendship.create({
      data: { userAId: lowId, userBId: highId, requestedById: lowId },
    })

    await expectRejection(
      prisma.friendship.create({
        data: { userAId: lowId, userBId: highId, requestedById: highId },
      }),
      /Unique constraint failed/,
    )
  })
})
