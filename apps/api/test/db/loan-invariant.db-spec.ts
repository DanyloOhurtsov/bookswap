import { createGraph, createUser, expectUniqueViolation } from './fixtures'
import { createTestPrismaClient, truncateAll } from './test-database'
import { LoanStatus } from '../../src/generated/prisma/enums'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * Інваріант §5.3.1: на один `Copy` не більше одного лоану в статусі APPROVED або
 * HANDED_OVER.
 *
 * Перевіряється саме на рівні БД. Сервісний шар (§5) робитиме те саме через
 * `SELECT … FOR UPDATE`, але індекс — це остання лінія: він тримає інваріант і
 * тоді, коли транзакція написана неправильно або дані правлять руками.
 */
describe('one_active_loan_per_copy', () => {
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

  async function createLoan(
    graph: Awaited<ReturnType<typeof createGraph>>,
    status: LoanStatus,
    borrowerId?: string,
  ): Promise<void> {
    await prisma.loan.create({
      data: {
        copyId: graph.copyId,
        ownerId: graph.ownerId,
        borrowerId: borrowerId ?? graph.borrowerId,
        status,
      },
    })
  }

  it('другий APPROVED на той самий примірник не проходить', async () => {
    const graph = await createGraph(prisma)
    const rival = await createUser(prisma, 'Конкурент')
    await createLoan(graph, LoanStatus.APPROVED)

    await expectUniqueViolation(
      prisma.loan.create({
        data: {
          copyId: graph.copyId,
          ownerId: graph.ownerId,
          borrowerId: rival,
          status: LoanStatus.APPROVED,
        },
      }),
      /copyId/,
    )
  })

  it('APPROVED поверх HANDED_OVER не проходить — обидва статуси активні', async () => {
    const graph = await createGraph(prisma)
    const rival = await createUser(prisma, 'Конкурент')
    await createLoan(graph, LoanStatus.HANDED_OVER)

    await expectUniqueViolation(
      prisma.loan.create({
        data: {
          copyId: graph.copyId,
          ownerId: graph.ownerId,
          borrowerId: rival,
          status: LoanStatus.APPROVED,
        },
      }),
      /copyId/,
    )
  })

  it('перехід APPROVED → HANDED_OVER не конфліктує сам із собою', async () => {
    const graph = await createGraph(prisma)
    await createLoan(graph, LoanStatus.APPROVED)

    const loan = await prisma.loan.findFirstOrThrow({ where: { copyId: graph.copyId } })
    await prisma.loan.update({
      where: { id: loan.id },
      data: { status: LoanStatus.HANDED_OVER },
    })

    expect(
      await prisma.loan.count({ where: { copyId: graph.copyId, status: LoanStatus.HANDED_OVER } }),
    ).toBe(1)
  })

  it('кілька REQUESTED на один примірник дозволені (§5.2, конкурентні запити)', async () => {
    const graph = await createGraph(prisma)
    const third = await createUser(prisma, 'Третій')

    await createLoan(graph, LoanStatus.REQUESTED)
    await createLoan(graph, LoanStatus.REQUESTED, third)

    expect(
      await prisma.loan.count({ where: { copyId: graph.copyId, status: LoanStatus.REQUESTED } }),
    ).toBe(2)
  })

  it('термінальні статуси не блокують новий активний лоан', async () => {
    const graph = await createGraph(prisma)

    for (const status of [
      LoanStatus.REJECTED,
      LoanStatus.CANCELLED,
      LoanStatus.RETURNED,
      LoanStatus.LOST,
    ]) {
      await createLoan(graph, status)
    }

    await createLoan(graph, LoanStatus.APPROVED)

    expect(await prisma.loan.count({ where: { copyId: graph.copyId } })).toBe(5)
  })

  it('після повернення примірник знову можна позичити', async () => {
    const graph = await createGraph(prisma)
    await createLoan(graph, LoanStatus.HANDED_OVER)

    const loan = await prisma.loan.findFirstOrThrow({ where: { copyId: graph.copyId } })
    await prisma.loan.update({ where: { id: loan.id }, data: { status: LoanStatus.RETURNED } })

    await createLoan(graph, LoanStatus.APPROVED)

    expect(
      await prisma.loan.count({ where: { copyId: graph.copyId, status: LoanStatus.APPROVED } }),
    ).toBe(1)
  })

  it('різні примірники одного видання позичаються незалежно (§3, кілька Copy)', async () => {
    const graph = await createGraph(prisma)
    const second = await prisma.copy.create({
      data: {
        editionId: graph.editionId,
        ownerId: graph.ownerId,
        currentHolderId: graph.ownerId,
      },
    })

    await createLoan(graph, LoanStatus.APPROVED)
    await prisma.loan.create({
      data: {
        copyId: second.id,
        ownerId: graph.ownerId,
        borrowerId: graph.borrowerId,
        status: LoanStatus.APPROVED,
      },
    })

    expect(await prisma.loan.count({ where: { status: LoanStatus.APPROVED } })).toBe(2)
  })
})
