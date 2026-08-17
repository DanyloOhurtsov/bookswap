import { Client } from 'pg'
import { createGraph, createUser } from './fixtures'
import { createTestPrismaClient, testDatabaseUrl, truncateAll } from './test-database'
import type { Graph } from './fixtures'
import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * §5.2 на рівні БД: `SELECT … FOR UPDATE` на рядку `Copy` серіалізує апруви, а
 * частковий унікальний індекс тримає інваріант §5.3.1 навіть тоді, коли блокування
 * написали неправильно.
 *
 * Це тест **механізму**, а не сервісу: він доводить, що обраний спосіб узагалі
 * працює в цій PostgreSQL. Тест самої стейт-машини — `loans-concurrency.e2e-spec.ts`,
 * і замінити один одним не можна: тут немає `LoanService`, там немає контролю над
 * моментом захоплення локу.
 *
 * Сирі `pg`-сесії, а не Prisma: інтерактивні транзакції Prisma не дають способу
 * «зупинитися тут і почекати», а саме цей момент і треба відтворити.
 *
 * Правило, без якого файл отруює весь прогін: **на заблокований запит не можна
 * чекати раніше, ніж звільнено лок, якого він чекає**. Інакше тест сам стає
 * взаємоблокуванням, сесія лишається з відкритою транзакцією, і наступний
 * `truncateAll` (йому потрібен ACCESS EXCLUSIVE) вішає вже сусідні файли.
 */
describe('конкурентність апруву на рівні БД (§5.2)', () => {
  let prisma: PrismaClient
  /** Усі відкриті сесії прогону — щоб жодна не пережила тест. */
  let sessions: Client[]

  beforeAll(() => {
    prisma = createTestPrismaClient()
  })

  beforeEach(async () => {
    sessions = []
    await truncateAll(prisma)
  })

  // Прибирання не в `finally` кожного тесту, а тут: `afterEach` виконується й
  // після провалу з винятком, тобто саме тоді, коли лок найімовірніше висить.
  afterEach(async () => {
    await Promise.allSettled(
      sessions.map(async (session) => {
        await session.query('ROLLBACK').catch(() => undefined)
        await session.end()
      }),
    )
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function session(): Promise<Client> {
    const client = new Client({ connectionString: testDatabaseUrl() })

    await client.connect()
    sessions.push(client)

    return client
  }

  async function pidOf(client: Client): Promise<number> {
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const pid = rows[0]?.pid

    if (pid === undefined) throw new Error('Не вдалося дізнатися pid сесії')

    return pid
  }

  /** Чи стоїть сесія в черзі за локом. Детермінована заміна `sleep`. */
  async function isWaiting(observer: Client, pid: number): Promise<boolean> {
    const { rows } = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE pid = $1 AND wait_event_type = 'Lock'`,
      [pid],
    )

    return rows[0]?.count === '1'
  }

  async function requestLoan(graph: Graph, borrowerId: string): Promise<string> {
    const loan = await prisma.loan.create({
      data: { copyId: graph.copyId, ownerId: graph.ownerId, borrowerId, status: 'REQUESTED' },
    })

    return loan.id
  }

  it('FOR UPDATE на Copy змушує другу транзакцію чекати', async () => {
    const graph = await createGraph(prisma)
    const first = await session()
    const second = await session()
    const observer = await session()
    const secondPid = await pidOf(second)

    await first.query('BEGIN')
    await first.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [graph.copyId])

    await second.query('BEGIN')
    // НЕ await: запит стане в чергу й не повернеться, поки перша не закінчить.
    const blocked = second.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [
      graph.copyId,
    ])

    // Друга сесія мусить СТАТИ В ЧЕРГУ, а не просто «трохи зачекати».
    // Перевіряється опитуванням pg_stat_activity: `sleep` фіксованої довжини на
    // повільній машині дав би зелений тест і на зламаному блокуванні.
    expect(await waitUntil(() => isWaiting(observer, secondPid))).toBe(true)

    await first.query('COMMIT')
    await blocked

    expect(await isWaiting(observer, secondPid)).toBe(false)
  }, 20_000)

  it('частковий індекс не дає другому APPROVED пройти навіть без FOR UPDATE', async () => {
    // Остання лінія оборони: якби блокування колись прибрали, інваріант §5.3.1
    // усе одно втримався б — ціною помилки замість тихого подвійного апруву.
    const graph = await createGraph(prisma)
    const rival = await createUser(prisma, 'Конкурент')
    const firstLoan = await requestLoan(graph, graph.borrowerId)
    const secondLoan = await requestLoan(graph, rival)

    const first = await session()
    const second = await session()
    const observer = await session()
    const secondPid = await pidOf(second)

    await first.query('BEGIN')
    await second.query('BEGIN')

    await first.query(`UPDATE "Loan" SET "status" = 'APPROVED' WHERE "id" = $1`, [firstLoan])

    // Унікальний індекс перевіряється на самому UPDATE, а не на коміті. Другий
    // запис натикається на ще НЕ закомічений ключ і стає в чергу — тому чекати
    // на нього до `COMMIT` першої транзакції не можна.
    const blocked = second
      .query(`UPDATE "Loan" SET "status" = 'APPROVED' WHERE "id" = $1`, [secondLoan])
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(await waitUntil(() => isWaiting(observer, secondPid))).toBe(true)

    await first.query('COMMIT')

    // Щойно перша закомітилася, ключ став видимим — і другий запис падає.
    expect(String(await blocked)).toMatch(/one_active_loan_per_copy/)

    await second.query('ROLLBACK')

    expect(await prisma.loan.count({ where: { copyId: graph.copyId, status: 'APPROVED' } })).toBe(1)
  }, 20_000)

  it('після коміту першої транзакції друга бачить оновлений рядок Loan', async () => {
    // Саме на цьому тримається сервіс: він перечитує `Loan` ПІСЛЯ захоплення
    // локу, бо `FOR UPDATE OF Copy` під EvalPlanQual освіжає лише заблоковану
    // таблицю. Без перечитування програвший гонку діяв би за застарілим
    // снапшотом і намагався б апрувнути вже відхилений запит.
    const graph = await createGraph(prisma)
    const loanId = await requestLoan(graph, graph.borrowerId)

    const first = await session()
    const second = await session()
    const observer = await session()
    const secondPid = await pidOf(second)

    await first.query('BEGIN')
    await first.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [graph.copyId])
    await first.query(`UPDATE "Loan" SET "status" = 'REJECTED' WHERE "id" = $1`, [loanId])

    await second.query('BEGIN')
    const blocked = second.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [
      graph.copyId,
    ])

    expect(await waitUntil(() => isWaiting(observer, secondPid))).toBe(true)

    await first.query('COMMIT')
    await blocked

    const { rows } = await second.query<{ status: string }>(
      'SELECT "status" FROM "Loan" WHERE "id" = $1',
      [loanId],
    )

    expect(rows[0]?.status).toBe('REJECTED')

    await second.query('COMMIT')
  }, 20_000)
})

/**
 * Опитування з таймаутом замість `sleep`.
 *
 * Тест про блокування, який чекає фіксований час, зеленіє на зламаному локу
 * рівно тоді, коли машина повільна, — тобто саме тоді, коли на нього
 * покладаються.
 */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check()) return true

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return false
}
