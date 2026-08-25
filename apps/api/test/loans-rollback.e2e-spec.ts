import 'reflect-metadata'
import { loanResponseSchema } from '@bookswap/shared'
import { createTestApp } from './auth.helpers'
import {
  actOnLoan,
  befriend,
  createShelfCopy,
  registerAccount,
  requestLoan,
  type Account,
  type Shelf,
} from './loan.helpers'
import { NotificationsService } from '../src/notifications/notifications.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * §7.3, правило 1: «запис сповіщення — у тій самій транзакції, що й перехід
 * статусу».
 *
 * Обіцянку «в одній транзакції» неможливо перевірити, дивлячись на успішний
 * шлях: там усе однаково сходиться. Єдиний спосіб її довести — зламати запис
 * сповіщення й переконатися, що разом із ним відкотилося ВСЕ інше. Тому
 * `NotificationsService.create` тут підмінений так, щоб кидати.
 *
 * Що саме доводиться: падіння після коміту лишило б подію без сліду, а падіння
 * до нього — сліди без події. Правильна поведінка — жодних слідів.
 */
describe('Атомарність переходів (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  /** Скільки викликів пропустити перед тим, як кинути. */
  let failAfter: number
  let calls: number

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(NotificationsService).useValue({
          create: () => {
            calls += 1

            if (calls > failAfter) {
              return Promise.reject(new Error('Симульований збій запису сповіщення'))
            }

            return Promise.resolve()
          },
          // Поштовх диспетчеру після коміту (§7.3). У цьому файлі він має бути
          // порожнім навмисно: перевіряється атомарність ЗАПИСУ, а справжній
          // диспетчер почав би розсилати сповіщення з сусідніх сценаріїв і
          // домішував би до перевірки власні звернення до бази.
          dispatchSoon: () => undefined,
        })
      },
    })

    prisma = app.get(PrismaService)
  })

  beforeEach(() => {
    // За замовчуванням сповіщення працюють: сетап сценарію (запити, апруви) не
    // має падати разом із тим кроком, який ми ламаємо навмисно.
    failAfter = Number.MAX_SAFE_INTEGER
    calls = 0
  })

  afterAll(async () => {
    await app.close()
  })

  async function pair(): Promise<{ owner: Account; borrower: Account; shelf: Shelf }> {
    const owner = await registerAccount(app, 'rollback-owner')
    const borrower = await registerAccount(app, 'rollback-borrower')

    await befriend(app, owner, borrower)

    return { owner, borrower, shelf: await createShelfCopy(app, owner) }
  }

  it('падіння на LOAN_REQUESTED не лишає ані лоану, ані слідів у примірнику', async () => {
    const { borrower, shelf } = await pair()

    failAfter = 0
    calls = 0

    await requestLoan(app, borrower, shelf.copyId).expect(500)

    // Рядка немає взагалі: інакше власник побачив би запит, про який його ніхто
    // не повідомив.
    expect(await prisma.loan.count({ where: { copyId: shelf.copyId } })).toBe(0)

    const copy = await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })

    expect(copy.status).toBe('AVAILABLE')
    expect(copy.currentHolderId).toBe(copy.ownerId)
  })

  it('падіння на апруві лишає лоан REQUESTED, а примірник — вільним', async () => {
    const { owner, borrower, shelf } = await pair()
    const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
    const loanId = loanResponseSchema.parse(created.body).loan.id

    failAfter = 0
    calls = 0

    await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(500)

    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })

    expect(loan.status).toBe('REQUESTED')
    expect(loan.respondedAt).toBeNull()

    const copy = await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })

    // Ані RESERVED, ані зміненого тримача: власник побачить, що його дія не
    // спрацювала, і це чесно — вона справді не спрацювала.
    expect(copy.status).toBe('AVAILABLE')
    expect(copy.currentHolderId).toBe(owner.id)
  })

  it('падіння на сповіщенні конкуренту відкочує і апрув, і вже відхилені запити', async () => {
    // Найтонший випадок: перше сповіщення (апрувленому) записалося, друге
    // (відхиленому конкуренту) впало. Часткове збереження лишило б конкурента
    // відхиленим без апруву — стан, який §5.1 не описує взагалі.
    const owner = await registerAccount(app, 'rollback-owner')
    const first = await registerAccount(app, 'rollback-first')
    const second = await registerAccount(app, 'rollback-second')

    await befriend(app, owner, first)
    await befriend(app, owner, second)

    const shelf = await createShelfCopy(app, owner)
    const firstCreated = await requestLoan(app, first, shelf.copyId).expect(201)
    const firstLoan = loanResponseSchema.parse(firstCreated.body).loan.id
    const secondCreated = await requestLoan(app, second, shelf.copyId).expect(201)
    const secondLoan = loanResponseSchema.parse(secondCreated.body).loan.id

    // Пропускаємо перший виклик (сповіщення апрувленому), падаємо на другому.
    failAfter = 1
    calls = 0

    await actOnLoan(app, owner, firstLoan, { action: 'approve' }).expect(500)

    expect((await prisma.loan.findUniqueOrThrow({ where: { id: firstLoan } })).status).toBe(
      'REQUESTED',
    )
    // Конкурент НЕ відхилений: відхилення й апрув живуть або разом, або ніяк.
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: secondLoan } })).status).toBe(
      'REQUESTED',
    )

    const copy = await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })

    expect(copy.status).toBe('AVAILABLE')
  })

  it('падіння на передачі не переносить володіння', async () => {
    const { owner, borrower, shelf } = await pair()
    const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
    const loanId = loanResponseSchema.parse(created.body).loan.id

    await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(200)

    failAfter = 0
    calls = 0

    await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(500)

    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })
    const copy = await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })

    expect(loan.status).toBe('APPROVED')
    expect(loan.handedAt).toBeNull()
    // Найважливіше: книжка не «переїхала» в базі, поки в реальності нічого не
    // сталося.
    expect(copy.status).toBe('RESERVED')
    expect(copy.currentHolderId).toBe(owner.id)
  })

  it('після відновлення запису той самий перехід проходить нормально', async () => {
    // Збій не лишає лоан у стані, з якого немає виходу.
    const { owner, borrower, shelf } = await pair()
    const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
    const loanId = loanResponseSchema.parse(created.body).loan.id

    failAfter = 0
    calls = 0
    await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(500)

    failAfter = Number.MAX_SAFE_INTEGER
    calls = 0
    await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(200)

    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe('APPROVED')
    expect((await prisma.copy.findUniqueOrThrow({ where: { id: shelf.copyId } })).status).toBe(
      'RESERVED',
    )
  })
})
