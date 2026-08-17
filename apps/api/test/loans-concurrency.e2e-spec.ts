import 'reflect-metadata'
import { Client } from 'pg'
import { API_ERROR_CODES, apiErrorSchema, loanResponseSchema } from '@bookswap/shared'
import { createTestApp } from './auth.helpers'
import { testDatabaseUrl } from './db/test-database'
import {
  actOnLoan,
  befriend,
  createShelfCopy,
  registerAccount,
  requestLoan,
  type Account,
} from './loan.helpers'
import { PrismaService } from '../src/prisma/prisma.service'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'
import type { Response } from 'supertest'

/**
 * §11: «конкурентний апрув — дві паралельні транзакції на один `copyId`,
 * перевірка, що рівно одна дійшла до `APPROVED`».
 *
 * Специфікація там же пояснює, чому цей тест не можна писати «потім»:
 * конкурентний апрув локально ніколи не зламається, бо розробник один і клікає
 * послідовно.
 *
 * Голого `Promise.all` для цього замало: він **сподівається**, що два запити
 * перетнуться, і на швидкій машині вони спокійно виконаються один за одним —
 * тест зеленітиме, нічого не перевіривши. Тому гонка влаштовується примусово:
 * окрема сесія тримає лок на `Copy`, обидва апруви гарантовано стають у чергу
 * (це підтверджується опитуванням `pg_stat_activity`, а не `sleep`), і лише потім
 * лок відпускається.
 */
describe('Конкурентний апрув (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let sessions: Client[]

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  beforeEach(() => {
    sessions = []
  })

  afterEach(async () => {
    await Promise.allSettled(
      sessions.map(async (session) => {
        await session.query('ROLLBACK').catch(() => undefined)
        await session.end()
      }),
    )
  })

  afterAll(async () => {
    await app.close()
  })

  async function session(): Promise<Client> {
    const client = new Client({ connectionString: testDatabaseUrl() })

    await client.connect()
    sessions.push(client)

    return client
  }

  /** Скільки сесій, крім наших службових, стоять у черзі за локом. */
  async function blockedCount(observer: Client, ownPids: number[]): Promise<number> {
    const { rows } = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE datname = current_database()
         AND wait_event_type = 'Lock'
         AND NOT (pid = ANY($1::int[]))`,
      [ownPids],
    )

    return Number(rows[0]?.count ?? '0')
  }

  async function pidOf(client: Client): Promise<number> {
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const pid = rows[0]?.pid

    if (pid === undefined) throw new Error('Не вдалося дізнатися pid сесії')

    return pid
  }

  async function notificationsOf(userId: string, loanId: string) {
    return prisma.notification.findMany({
      where: { userId, payload: { path: ['loanId'], equals: loanId } },
    })
  }

  it('три запити, два одночасні апруви: рівно один APPROVED, решта REJECTED', async () => {
    const owner = await registerAccount(app, 'race-owner')
    const first = await registerAccount(app, 'race-first')
    const second = await registerAccount(app, 'race-second')
    const third = await registerAccount(app, 'race-third')
    const borrowers: Account[] = [first, second, third]

    for (const borrower of borrowers) {
      await befriend(app, owner, borrower)
    }

    const shelf = await createShelfCopy(app, owner)
    const loanIds: string[] = []

    // §5.2: кільком людям дозволено одночасно мати REQUESTED на один примірник.
    for (const borrower of borrowers) {
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)

      loanIds.push(loanResponseSchema.parse(created.body).loan.id)
    }

    const [firstLoan, secondLoan, thirdLoan] = loanIds

    if (firstLoan === undefined || secondLoan === undefined || thirdLoan === undefined) {
      throw new Error('Недосяжно: створено рівно три запити')
    }

    const holder = await session()
    const observer = await session()
    const ownPids = [await pidOf(holder), await pidOf(observer)]

    // 1. Тримаємо лок на Copy — рівно той рядок, який захоплює LoanService.
    await holder.query('BEGIN')
    await holder.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [shelf.copyId])

    // 2. Обидва апруви впираються в цей лок і чекають.
    const race = Promise.all([
      actOnLoan(app, owner, firstLoan, { action: 'approve' }),
      actOnLoan(app, owner, secondLoan, { action: 'approve' }),
    ])

    // 3. Переконуємося, що обидва СПРАВДІ стали в чергу, а не просто ще не
    //    встигли. Без цієї перевірки тест зеленів би й тоді, коли блокування
    //    зламане, — досить було б, щоб запити не перетнулися в часі.
    expect(await waitUntil(async () => (await blockedCount(observer, ownPids)) >= 2)).toBe(true)

    // 4. Відпускаємо — і лише тепер починається справжня гонка.
    await holder.query('COMMIT')

    const responses = await race

    // Рівно один переміг, рівно один програв, жодної 5xx.
    const statuses = responses.map((response: Response) => response.status).sort()

    expect(statuses).toEqual([200, 409])

    const loser = responses.find((response: Response) => response.status === 409)

    if (loser === undefined) throw new Error('Недосяжно: один із запитів мусив програти')

    // За коректного блокування програвший перечитує свій лоан під локом і
    // бачить його вже відхиленим — звідси LOAN_INVALID_TRANSITION. Якби лок
    // не спрацював, спрацював би частковий індекс і код був би
    // LOAN_ALREADY_APPROVED. Обидва прийнятні; 5xx і 200 — ні.
    expect([
      API_ERROR_CODES.LOAN_INVALID_TRANSITION,
      API_ERROR_CODES.LOAN_ALREADY_APPROVED,
    ]).toContain(apiErrorSchema.parse(loser.body).code)

    // --- Стан лоанів ---------------------------------------------------------
    const approved = await prisma.loan.findMany({
      where: { copyId: shelf.copyId, status: 'APPROVED' },
    })

    expect(approved).toHaveLength(1)

    const approvedId = approved[0]?.id
    const rejected = await prisma.loan.findMany({
      where: { copyId: shelf.copyId, status: 'REJECTED' },
    })

    // §5.1: «усі інші REQUESTED на цей примірник → REJECTED». Включно з тим,
    // хто в гонці навіть не брав участі.
    expect(rejected.map((loan) => loan.id).sort()).toEqual(
      loanIds.filter((id) => id !== approvedId).sort(),
    )
    expect(await prisma.loan.count({ where: { copyId: shelf.copyId, status: 'REQUESTED' } })).toBe(
      0,
    )

    // Відхилені конкуренти отримують позначку відповіді (§5.1).
    for (const loan of rejected) {
      expect(loan.respondedAt).not.toBeNull()
    }

    // --- Стан примірника -----------------------------------------------------
    const copy = await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })

    expect(copy.status).toBe('RESERVED')
    // §5.2: апрув не передає володіння.
    expect(copy.currentHolderId).toBe(owner.id)

    // --- Сповіщення ----------------------------------------------------------
    for (const borrower of borrowers) {
      const loanId = loanIds[borrowers.indexOf(borrower)]

      if (loanId === undefined) throw new Error('Недосяжно')

      const notifications = await notificationsOf(borrower.id, loanId)

      // Рівно одне на людину — ні дублікатів від повторної спроби, ні тиші.
      expect(notifications).toHaveLength(1)

      const [notification] = notifications
      const rejected = loanId !== approvedId

      expect(notification?.type).toBe(rejected ? 'LOAN_REJECTED' : 'LOAN_APPROVED')

      // §4.8: payload — «loanId, copyId, actorId». Кожне поле мусить означати
      // саме те, що каже його назва.
      expect(notification?.payload).toEqual({
        // Свій лоан, а не апрувлений: сповіщення веде людину до її власного
        // запиту, до чужого вона однаково не має доступу.
        loanId,
        copyId: shelf.copyId,
        // Той, ХТО ДІЯВ, — власник. Регресія, через яку тут стояв id апрувленого
        // лоану, ламала б етап 3: `actorId` розгортається в ім'я людини в тексті
        // листа й повідомлення в Telegram.
        actorId: owner.id,
      })

      const actorId = (notification?.payload as { actorId?: unknown } | undefined)?.actorId

      expect(actorId).not.toBe(approvedId)
      expect(actorId).not.toBe(loanId)
    }
  }, 60_000)

  it('авто-відхилення несе actorId власника, а не id лоану', async () => {
    // Той самий інваріант без гонки — щоб регресію було видно й на простому шляху.
    const owner = await registerAccount(app, 'payload-owner')
    const first = await registerAccount(app, 'payload-first')
    const second = await registerAccount(app, 'payload-second')

    await befriend(app, owner, first)
    await befriend(app, owner, second)

    const shelf = await createShelfCopy(app, owner)
    const winner = await requestLoan(app, first, shelf.copyId).expect(201)
    const loser = await requestLoan(app, second, shelf.copyId).expect(201)
    const winnerId = loanResponseSchema.parse(winner.body).loan.id
    const loserId = loanResponseSchema.parse(loser.body).loan.id

    await actOnLoan(app, owner, winnerId, { action: 'approve' }).expect(200)

    const rejected = await notificationsOf(second.id, loserId)

    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.type).toBe('LOAN_REJECTED')
    expect(rejected[0]?.payload).toEqual({
      loanId: loserId,
      copyId: shelf.copyId,
      actorId: owner.id,
    })

    // Апрувлений отримує своє — з тим самим актором.
    const approved = await notificationsOf(first.id, winnerId)

    expect(approved).toHaveLength(1)
    expect(approved[0]?.payload).toEqual({
      loanId: winnerId,
      copyId: shelf.copyId,
      actorId: owner.id,
    })
  }, 60_000)

  /**
   * Локувальний запит фільтрує за сторонами лоану, тож чужий актор не потрапляє
   * в чергу за локом узагалі.
   *
   * Без цієї умови будь-хто автентифікований, знаючи чужий `loanId`, ставав би за
   * локом чужого `Copy` — авторизація відбувалася б **після** захоплення ресурсу,
   * і сторонній міг би тримати справжніх учасників, поки його транзакція повзе
   * до 404. Тут це перевіряється не міркуванням, а часом: лок утримується
   * навмисно, і 404 мусить прийти, **не чекаючи** його звільнення.
   */
  it('сторонній отримує 404, не стаючи в чергу за чужим локом', async () => {
    const owner = await registerAccount(app, 'lock-owner')
    const borrower = await registerAccount(app, 'lock-borrower')
    const stranger = await registerAccount(app, 'lock-stranger')

    await befriend(app, owner, borrower)

    const shelf = await createShelfCopy(app, owner)
    const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
    const loanId = loanResponseSchema.parse(created.body).loan.id

    const holder = await session()
    const observer = await session()
    const ownPids = [await pidOf(holder), await pidOf(observer)]

    await holder.query('BEGIN')
    await holder.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [shelf.copyId])

    // 1. Сторонній: відповідь мусить прийти, поки лок ще утримується.
    const refused = await actOnLoan(app, stranger, loanId, { action: 'approve' }).expect(404)

    expect(apiErrorSchema.parse(refused.body).code).toBe(API_ERROR_CODES.NOT_FOUND)
    // Ніхто не стоїть у черзі: сторонній не дійшов до локу.
    expect(await blockedCount(observer, ownPids)).toBe(0)

    // 2. Контрольна проба: справжній учасник поводиться навпаки — стає в чергу й
    //    чекає. Без цієї половини тест проходив би й на зламаному блокуванні.
    //
    //    `.then()` обовʼязковий: запит supertest лінивий і не йде на сервер,
    //    доки його не «спожили». Без цього рядка ми чекали б на чергу, у яку
    //    ніхто не ставав.
    const legitimate = actOnLoan(app, owner, loanId, { action: 'approve' })
      .expect(200)
      .then(() => undefined)

    expect(await waitUntil(async () => (await blockedCount(observer, ownPids)) >= 1)).toBe(true)

    await holder.query('COMMIT')

    await legitimate

    // 3. Стан не змінився від спроби стороннього — лише від дії власника.
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })

    expect(loan.status).toBe('APPROVED')
  }, 60_000)

  it('одночасні апрув і скасування сходяться до узгодженого стану', async () => {
    // Друга форма тієї самої гонки: власник підтверджує, позичальник тієї ж
    // миті забирає запит.
    //
    // Тут, на відміну від двох апрувів, ОБИДВІ відповіді можуть бути успішними —
    // і це не збій, а §5.1: якщо першим встиг апрув, скасування з `APPROVED`
    // дозволене обом сторонам. Якщо ж першим встигло скасування, апрув отримує
    // 409. Тому перевіряється не набір кодів, а те, заради чого гонка й
    // розвʼязується: кінцевий стан однаковий в обох порядках, і `Copy`
    // узгоджений із `Loan`.
    const owner = await registerAccount(app, 'clash-owner')
    const borrower = await registerAccount(app, 'clash-borrower')

    await befriend(app, owner, borrower)

    const shelf = await createShelfCopy(app, owner)
    const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
    const loanId = loanResponseSchema.parse(created.body).loan.id

    const holder = await session()
    const observer = await session()
    const ownPids = [await pidOf(holder), await pidOf(observer)]

    await holder.query('BEGIN')
    await holder.query('SELECT "id" FROM "Copy" WHERE "id" = $1 FOR UPDATE', [shelf.copyId])

    const race = Promise.all([
      actOnLoan(app, owner, loanId, { action: 'approve' }),
      actOnLoan(app, borrower, loanId, { action: 'cancel' }),
    ])

    expect(await waitUntil(async () => (await blockedCount(observer, ownPids)) >= 2)).toBe(true)

    await holder.query('COMMIT')

    const responses = await race

    // Жодної 5xx: гонка — очікуваний режим роботи, а не аварія.
    for (const response of responses) {
      expect(response.status).toBeLessThan(500)
    }

    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })
    const copy = await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })

    // Обидва порядки сходяться до одного: позичальник передумав, книжка вільна.
    expect(loan.status).toBe('CANCELLED')
    expect(copy.status).toBe('AVAILABLE')
    expect(copy.currentHolderId).toBe(owner.id)
  }, 60_000)
})

/**
 * Опитування з таймаутом замість `sleep`.
 *
 * Тест про блокування, який чекає фіксований час, зеленіє на зламаному локу рівно
 * тоді, коли машина повільна, — тобто саме тоді, коли на нього покладаються.
 */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check()) return true

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return false
}
