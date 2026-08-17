import 'reflect-metadata'
import request from 'supertest'
import {
  API_ERROR_CODES,
  apiErrorSchema,
  loanResponseSchema,
  visibleLibraryResponseSchema,
} from '@bookswap/shared'
import { createTestApp } from './auth.helpers'
import {
  actOnLoan,
  approvedLoan,
  befriend,
  createShelfCopy,
  handedOverLoan,
  registerAccount,
  requestLoan,
  url,
  type Account,
  type Shelf,
} from './loan.helpers'
import { PrismaService } from '../src/prisma/prisma.service'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * §5.1 повністю: кожен позитивний перехід, кожен негативний, кожен неправильний
 * актор — плюс інваріанти §5.3 на живій PostgreSQL.
 *
 * ВАЖЛИВО про ізоляцію: e2e-файли ділять одну тестову базу й нічого не чистять
 * між тестами. Тому кожна перевірка стану БД звужена за id — жодних `count()`
 * без `where`.
 */
describe('Позичання (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  /** Двоє друзів і примірник на полиці власника — передумова майже всіх сценаріїв. */
  async function pair(): Promise<{ owner: Account; borrower: Account; shelf: Shelf }> {
    const owner = await registerAccount(app, 'owner')
    const borrower = await registerAccount(app, 'borrower')

    await befriend(app, owner, borrower)

    return { owner, borrower, shelf: await createShelfCopy(app, owner) }
  }

  const copyOf = (copyId: string) => prisma.copy.findUniqueOrThrow({ where: { id: copyId } })

  const loanOf = (loanId: string) => prisma.loan.findUniqueOrThrow({ where: { id: loanId } })

  const codeOf = (body: unknown): string => apiErrorSchema.parse(body).code

  // --- Позитивні переходи §5.1 -----------------------------------------------

  describe('позитивні переходи', () => {
    it('повний ланцюг: REQUESTED → APPROVED → HANDED_OVER → RETURNED', async () => {
      const { owner, borrower, shelf } = await pair()

      const created = await requestLoan(app, borrower, shelf.copyId, {
        message: 'дуже хочу почитати',
      }).expect(201)
      const loan = loanResponseSchema.parse(created.body).loan

      expect(loan.status).toBe('REQUESTED')
      expect(loan.message).toBe('дуже хочу почитати')
      // §5.1: створення запиту примірника не змінює взагалі.
      expect((await copyOf(shelf.copyId)).status).toBe('AVAILABLE')

      const approved = await actOnLoan(app, owner, loan.id, {
        action: 'approve',
        dueAt: '2026-12-31',
        note: 'тримай до Різдва',
      }).expect(200)

      expect(loanResponseSchema.parse(approved.body).loan.status).toBe('APPROVED')
      expect(loanResponseSchema.parse(approved.body).loan.dueAt).toBe('2026-12-31')
      expect(loanResponseSchema.parse(approved.body).loan.responseNote).toBe('тримай до Різдва')

      const handed = await actOnLoan(app, borrower, loan.id, { action: 'hand_over' }).expect(200)

      expect(loanResponseSchema.parse(handed.body).loan.status).toBe('HANDED_OVER')

      const returned = await actOnLoan(app, owner, loan.id, { action: 'return' }).expect(200)

      expect(loanResponseSchema.parse(returned.body).loan.status).toBe('RETURNED')

      const copy = await copyOf(shelf.copyId)

      expect(copy.status).toBe('AVAILABLE')
      expect(copy.currentHolderId).toBe(owner.id)
    })

    it('REQUESTED → REJECTED власником', async () => {
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      const rejected = await actOnLoan(app, owner, loanId, {
        action: 'reject',
        note: 'вже обіцяв іншому',
      }).expect(200)

      expect(loanResponseSchema.parse(rejected.body).loan.status).toBe('REJECTED')
      // Відмова примірника не чіпає — він і не був зайнятий.
      expect((await copyOf(shelf.copyId)).status).toBe('AVAILABLE')
    })

    it('REQUESTED → CANCELLED позичальником', async () => {
      const { borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      const cancelled = await actOnLoan(app, borrower, loanId, { action: 'cancel' }).expect(200)

      expect(loanResponseSchema.parse(cancelled.body).loan.status).toBe('CANCELLED')
    })

    it('APPROVED → CANCELLED — обома сторонами, і примірник звільняється', async () => {
      // §5.1: єдиний рядок таблиці, доступний обом. Домовитися могли двоє, тож і
      // розмовитися має право кожен.
      const first = await pair()
      const firstLoan = await approvedLoan(app, first.owner, first.borrower, first.shelf.copyId)

      await actOnLoan(app, first.owner, firstLoan, { action: 'cancel' }).expect(200)
      expect((await copyOf(first.shelf.copyId)).status).toBe('AVAILABLE')

      const second = await pair()
      const secondLoan = await approvedLoan(app, second.owner, second.borrower, second.shelf.copyId)

      await actOnLoan(app, second.borrower, secondLoan, { action: 'cancel' }).expect(200)
      expect((await copyOf(second.shelf.copyId)).status).toBe('AVAILABLE')
    })

    it('HANDED_OVER → LOST лишає книжку в позичальника', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      const lost = await actOnLoan(app, owner, loanId, { action: 'mark_lost' }).expect(200)

      expect(loanResponseSchema.parse(lost.body).loan.status).toBe('LOST')

      const copy = await copyOf(shelf.copyId)

      // §5.1 прямо: «`currentHolderId` лишається на позичальнику». Книжка фізично
      // в нього — модель не має права вдавати, що вона повернулася.
      expect(copy.status).toBe('UNAVAILABLE')
      expect(copy.currentHolderId).toBe(borrower.id)
    })
  })

  // --- Інваріанти §5.3 --------------------------------------------------------

  describe('інваріанти §5.3', () => {
    it('APPROVED НЕ змінює currentHolderId (§5.2: підтвердження ≠ передача)', async () => {
      const { owner, borrower, shelf } = await pair()

      await approvedLoan(app, owner, borrower, shelf.copyId)

      const copy = await copyOf(shelf.copyId)

      expect(copy.status).toBe('RESERVED')
      expect(copy.currentHolderId).toBe(owner.id)
    })

    it('лише HANDED_OVER передає фізичне володіння', async () => {
      const { owner, borrower, shelf } = await pair()

      await handedOverLoan(app, owner, borrower, shelf.copyId)

      const copy = await copyOf(shelf.copyId)

      expect(copy.status).toBe('LENT_OUT')
      expect(copy.currentHolderId).toBe(borrower.id)
    })

    it('§5.3.3: при LENT_OUT існує рівно один HANDED_OVER із borrowerId = currentHolderId', async () => {
      const { owner, borrower, shelf } = await pair()

      await handedOverLoan(app, owner, borrower, shelf.copyId)

      const copy = await copyOf(shelf.copyId)
      const handed = await prisma.loan.findMany({
        where: { copyId: shelf.copyId, status: 'HANDED_OVER' },
      })

      expect(handed).toHaveLength(1)
      expect(handed[0]?.borrowerId).toBe(copy.currentHolderId)
    })

    it('§5.3.1: другий активний лоан на примірник неможливий', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'rival')

      await befriend(app, owner, rival)
      await approvedLoan(app, owner, borrower, shelf.copyId)

      // Примірник уже RESERVED, тож новий запит навіть не створюється.
      const blocked = await requestLoan(app, rival, shelf.copyId).expect(409)

      expect(codeOf(blocked.body)).toBe(API_ERROR_CODES.LOAN_COPY_UNAVAILABLE)
      expect(
        await prisma.loan.count({
          where: { copyId: shelf.copyId, status: { in: ['APPROVED', 'HANDED_OVER'] } },
        }),
      ).toBe(1)
    })

    it('§5.2: ланцюгове позичання заборонене', async () => {
      // Позичальник, у якого книжка на руках, не може передати її далі: створити
      // `Loan` вправі лише власник примірника, а `ownerId` завжди береться з `Copy`.
      const { owner, borrower, shelf } = await pair()
      const third = await registerAccount(app, 'third')

      // Друг ОБОХ — інакше запит відсікла б перевірка дружби, і тест доводив би
      // не те: нас цікавить саме стан примірника, а не відсутність знайомства.
      await befriend(app, borrower, third)
      await befriend(app, owner, third)
      await handedOverLoan(app, owner, borrower, shelf.copyId)

      const chained = await requestLoan(app, third, shelf.copyId).expect(409)

      expect(codeOf(chained.body)).toBe(API_ERROR_CODES.LOAN_COPY_UNAVAILABLE)

      // Головне: жодного лоану, де книжку дає не її власник. `ownerId`
      // денормалізується з `Copy`, тож іншого шляху просто немає.
      expect(
        await prisma.loan.count({ where: { copyId: shelf.copyId, ownerId: borrower.id } }),
      ).toBe(0)
    })

    it('§5.2: видалення з друзів НЕ скасовує активний лоан', async () => {
      // Фізична книжка все одно в когось, тож повернення мусить лишатися можливим.
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      await request(app.getHttpServer())
        .delete(url(`/friends/${borrower.id}`))
        .set('Cookie', owner.cookie)
        .expect(204)

      expect((await loanOf(loanId)).status).toBe('HANDED_OVER')

      await actOnLoan(app, owner, loanId, { action: 'return' }).expect(200)

      expect((await loanOf(loanId)).status).toBe('RETURNED')
    })

    it('блокування після початку лоану не блокує повернення', async () => {
      // Інакше блокування стало б інструментом утримання чужої речі.
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      await request(app.getHttpServer())
        .post(url(`/friends/${owner.id}/block`))
        .set('Cookie', borrower.cookie)
        .expect(204)

      await actOnLoan(app, owner, loanId, { action: 'return' }).expect(200)

      expect((await loanOf(loanId)).status).toBe('RETURNED')
    })

    it('зміна visibility на PRIVATE не ламає активний лоан', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      await request(app.getHttpServer())
        .patch(url(`/me/library/${shelf.copyId}`))
        .set('Cookie', owner.cookie)
        .send({ visibility: 'PRIVATE' })
        .expect(200)

      await actOnLoan(app, owner, loanId, { action: 'return' }).expect(200)
    })
  })

  // --- Передумови створення §5.1 ----------------------------------------------

  describe('передумови створення запиту', () => {
    it('не друг отримує 403', async () => {
      const owner = await registerAccount(app, 'owner')
      const stranger = await registerAccount(app, 'stranger')
      const shelf = await createShelfCopy(app, owner, 'PUBLIC')

      const refused = await requestLoan(app, stranger, shelf.copyId).expect(403)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.FORBIDDEN)
    })

    it('заблокований отримує 403 FRIENDSHIP_BLOCKED', async () => {
      const { owner, borrower, shelf } = await pair()

      await request(app.getHttpServer())
        .post(url(`/friends/${borrower.id}/block`))
        .set('Cookie', owner.cookie)
        .expect(204)

      const refused = await requestLoan(app, borrower, shelf.copyId).expect(403)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
    })

    it('невидимий примірник — 404, а не 403', async () => {
      // 403 підтвердив би, що примірник із таким id у цієї людини є.
      const owner = await registerAccount(app, 'owner')
      const borrower = await registerAccount(app, 'borrower')

      await befriend(app, owner, borrower)

      const shelf = await createShelfCopy(app, owner, 'PRIVATE')
      const refused = await requestLoan(app, borrower, shelf.copyId).expect(404)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.NOT_FOUND)
    })

    it('власний примірник — 400 LOAN_SELF', async () => {
      const owner = await registerAccount(app, 'owner')
      const shelf = await createShelfCopy(app, owner)

      const refused = await requestLoan(app, owner, shelf.copyId).expect(400)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_SELF)
    })

    it('UNAVAILABLE-примірник — 409 LOAN_COPY_UNAVAILABLE', async () => {
      const { owner, borrower, shelf } = await pair()

      await request(app.getHttpServer())
        .patch(url(`/me/library/${shelf.copyId}`))
        .set('Cookie', owner.cookie)
        .send({ status: 'UNAVAILABLE' })
        .expect(200)

      const refused = await requestLoan(app, borrower, shelf.copyId).expect(409)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_COPY_UNAVAILABLE)
    })

    it('повторний власний запит — 409 LOAN_DUPLICATE_REQUEST', async () => {
      const { borrower, shelf } = await pair()

      await requestLoan(app, borrower, shelf.copyId).expect(201)

      const refused = await requestLoan(app, borrower, shelf.copyId).expect(409)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_DUPLICATE_REQUEST)
    })

    it('чужі одночасні запити §5.2 дозволені', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'rival')

      await befriend(app, owner, rival)
      await requestLoan(app, borrower, shelf.copyId).expect(201)
      await requestLoan(app, rival, shelf.copyId).expect(201)

      expect(
        await prisma.loan.count({ where: { copyId: shelf.copyId, status: 'REQUESTED' } }),
      ).toBe(2)
    })
  })

  // --- Негативні переходи й ролі ----------------------------------------------

  describe('негативні переходи', () => {
    it('дія з неможливого статусу — 409 LOAN_INVALID_TRANSITION', async () => {
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      // Із REQUESTED не можна ні передати, ні повернути, ні списати.
      for (const action of ['hand_over', 'return', 'mark_lost']) {
        const refused = await actOnLoan(app, owner, loanId, { action }).expect(409)

        expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_INVALID_TRANSITION)
      }
    })

    it('термінальний лоан не рухається жодною дією', async () => {
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      await actOnLoan(app, owner, loanId, { action: 'reject' }).expect(200)

      for (const action of ['approve', 'reject', 'cancel', 'hand_over', 'return', 'mark_lost']) {
        const refused = await actOnLoan(app, owner, loanId, { action }).expect(409)

        expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_INVALID_TRANSITION)
      }
    })

    it('неправильний актор — 403 FORBIDDEN', async () => {
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      // Позичальник не апрувить власний запит і не відхиляє його.
      for (const action of ['approve', 'reject']) {
        const refused = await actOnLoan(app, borrower, loanId, { action }).expect(403)

        expect(codeOf(refused.body)).toBe(API_ERROR_CODES.FORBIDDEN)
      }

      // Власник не скасовує чужий запит — для цього є `reject`.
      expect(
        codeOf((await actOnLoan(app, owner, loanId, { action: 'cancel' }).expect(403)).body),
      ).toBe(API_ERROR_CODES.FORBIDDEN)

      await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(200)

      // «Отримав» тисне той, хто отримав, а не той, хто дав.
      expect(
        codeOf((await actOnLoan(app, owner, loanId, { action: 'hand_over' }).expect(403)).body),
      ).toBe(API_ERROR_CODES.FORBIDDEN)

      await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(200)

      // Повернення й списання підтверджує власник — він бачить книжку на полиці.
      for (const action of ['return', 'mark_lost']) {
        const refused = await actOnLoan(app, borrower, loanId, { action }).expect(403)

        expect(codeOf(refused.body)).toBe(API_ERROR_CODES.FORBIDDEN)
      }
    })

    it('сторонній не бачить і не рухає чужий лоан — 404 в обох випадках', async () => {
      const { borrower, shelf } = await pair()
      const stranger = await registerAccount(app, 'stranger')
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      await request(app.getHttpServer())
        .get(url(`/loans/${loanId}`))
        .set('Cookie', stranger.cookie)
        .expect(404)

      await actOnLoan(app, stranger, loanId, { action: 'approve' }).expect(404)

      expect((await loanOf(loanId)).status).toBe('REQUESTED')
    })

    it('термін повернення приймається лише разом із approve', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await approvedLoan(app, owner, borrower, shelf.copyId)

      const refused = await actOnLoan(app, borrower, loanId, {
        action: 'hand_over',
        dueAt: '2026-12-31',
      }).expect(400)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.VALIDATION_ERROR)
      // Мовчазне ігнорування було б гіршим: клієнт вважав би термін збереженим.
      expect((await loanOf(loanId)).status).toBe('APPROVED')
    })
  })

  // --- Передумови на стан примірника ------------------------------------------

  describe('передумови на Copy', () => {
    it('розʼїхані дані дають 409 LOAN_COPY_STATE_MISMATCH і нічого не міняють', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await approvedLoan(app, owner, borrower, shelf.copyId)

      // Примірник зсунули в обхід стейт-машини — рівно те, від чого §5 застерігає.
      await prisma.copy.update({ where: { id: shelf.copyId }, data: { status: 'AVAILABLE' } })

      const refused = await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(409)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_COPY_STATE_MISMATCH)
      expect((await loanOf(loanId)).status).toBe('APPROVED')
      expect((await copyOf(shelf.copyId)).status).toBe('AVAILABLE')
    })

    it('reject і cancel працюють на UNAVAILABLE-примірнику й не «виправляють» його', async () => {
      // Власник після появи запиту передумав давати книжку. Прибрати висячий
      // запит треба вміти саме тоді — і не скасовувати при цьому його рішення.
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      await request(app.getHttpServer())
        .patch(url(`/me/library/${shelf.copyId}`))
        .set('Cookie', owner.cookie)
        .send({ status: 'UNAVAILABLE' })
        .expect(200)

      await actOnLoan(app, owner, loanId, { action: 'reject' }).expect(200)

      expect((await copyOf(shelf.copyId)).status).toBe('UNAVAILABLE')

      // Те саме для скасування позичальником.
      const second = await pair()
      const secondCreated = await requestLoan(app, second.borrower, second.shelf.copyId).expect(201)
      const secondLoan = loanResponseSchema.parse(secondCreated.body).loan.id

      await request(app.getHttpServer())
        .patch(url(`/me/library/${second.shelf.copyId}`))
        .set('Cookie', second.owner.cookie)
        .send({ status: 'UNAVAILABLE' })
        .expect(200)

      await actOnLoan(app, second.borrower, secondLoan, { action: 'cancel' }).expect(200)

      expect((await copyOf(second.shelf.copyId)).status).toBe('UNAVAILABLE')
    })
  })

  // --- Timestamps §5.1 --------------------------------------------------------

  describe('timestamps', () => {
    it('respondedAt ставить лише відповідь власника', async () => {
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      expect((await loanOf(loanId)).respondedAt).toBeNull()

      await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(200)

      expect((await loanOf(loanId)).respondedAt).not.toBeNull()
    })

    it('скасування запиту не ставить respondedAt: відповіді не було', async () => {
      const { borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      await actOnLoan(app, borrower, loanId, { action: 'cancel' }).expect(200)

      expect((await loanOf(loanId)).respondedAt).toBeNull()
    })

    it('скасування домовленості НЕ перезаписує respondedAt від апруву', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await approvedLoan(app, owner, borrower, shelf.copyId)
      const afterApprove = (await loanOf(loanId)).respondedAt

      expect(afterApprove).not.toBeNull()

      await actOnLoan(app, borrower, loanId, { action: 'cancel' }).expect(200)

      expect((await loanOf(loanId)).respondedAt).toEqual(afterApprove)
    })

    it('handedAt — лише передача, returnedAt — лише повернення', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await approvedLoan(app, owner, borrower, shelf.copyId)

      expect((await loanOf(loanId)).handedAt).toBeNull()

      await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(200)

      const handed = await loanOf(loanId)

      expect(handed.handedAt).not.toBeNull()
      expect(handed.returnedAt).toBeNull()

      await actOnLoan(app, owner, loanId, { action: 'return' }).expect(200)

      expect((await loanOf(loanId)).returnedAt).not.toBeNull()
    })

    it('списання не додає жодної позначки', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)
      const before = await loanOf(loanId)

      await actOnLoan(app, owner, loanId, { action: 'mark_lost' }).expect(200)

      const after = await loanOf(loanId)

      expect(after.returnedAt).toBeNull()
      expect(after.respondedAt).toEqual(before.respondedAt)
      expect(after.handedAt).toEqual(before.handedAt)
    })
  })

  // --- Прострочення §5.2 ------------------------------------------------------

  describe('прострочення', () => {
    it('overdue — похідний прапорець, а не статус', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      await prisma.loan.update({
        where: { id: loanId },
        data: { dueAt: new Date('2020-01-01T23:59:59.999Z') },
      })

      const response = await request(app.getHttpServer())
        .get(url(`/loans/${loanId}`))
        .set('Cookie', owner.cookie)
        .expect(200)

      const loan = loanResponseSchema.parse(response.body).loan

      expect(loan.isOverdue).toBe(true)
      // Статус лишається HANDED_OVER: окремого OVERDUE в моделі немає (§5.2).
      expect(loan.status).toBe('HANDED_OVER')
      expect((await loanOf(loanId)).status).toBe('HANDED_OVER')
    })

    it('до кінця вказаного дня прострочення немає', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      await prisma.loan.update({
        where: { id: loanId },
        data: { dueAt: new Date(`${tomorrow}T23:59:59.999Z`) },
      })

      const response = await request(app.getHttpServer())
        .get(url(`/loans/${loanId}`))
        .set('Cookie', borrower.cookie)
        .expect(200)

      expect(loanResponseSchema.parse(response.body).loan.isOverdue).toBe(false)
    })
  })

  // --- Списки §8 --------------------------------------------------------------

  describe('GET /loans', () => {
    it('фільтрує за роллю і статусом, і показує лише свої', async () => {
      const { owner, borrower, shelf } = await pair()
      const stranger = await registerAccount(app, 'stranger')
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      const asOwner = await request(app.getHttpServer())
        .get(url('/loans?role=owner&status=REQUESTED'))
        .set('Cookie', owner.cookie)
        .expect(200)

      expect((asOwner.body as { loans: { id: string }[] }).loans.map((loan) => loan.id)).toContain(
        loanId,
      )

      // Той самий лоан із іншого боку — інша роль.
      const asBorrower = await request(app.getHttpServer())
        .get(url('/loans?role=borrower'))
        .set('Cookie', borrower.cookie)
        .expect(200)

      expect(
        (asBorrower.body as { loans: { id: string }[] }).loans.map((loan) => loan.id),
      ).toContain(loanId)

      // А з ролі власника позичальник його не бачить.
      const wrongSide = await request(app.getHttpServer())
        .get(url('/loans?role=owner'))
        .set('Cookie', borrower.cookie)
        .expect(200)

      expect(
        (wrongSide.body as { loans: { id: string }[] }).loans.map((loan) => loan.id),
      ).not.toContain(loanId)

      const outsider = await request(app.getHttpServer())
        .get(url('/loans'))
        .set('Cookie', stranger.cookie)
        .expect(200)

      expect((outsider.body as { loans: unknown[] }).loans).toHaveLength(0)
    })
  })

  // --- Контекст позичання у бібліотеці §6.5 -----------------------------------

  describe('capability canRequest (§6.5, §9)', () => {
    /** Примірники з полиці власника — рівно те, що бачить конкретний глядач. */
    async function copiesFor(viewer: Account, owner: Account) {
      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', viewer.cookie)
        .expect(200)

      return visibleLibraryResponseSchema
        .parse(response.body)
        .groups.flatMap((group) => group.copies)
    }

    it('FRIEND отримує canRequest = true — і POST справді проходить', async () => {
      const { owner, borrower, shelf } = await pair()
      const [copy] = await copiesFor(borrower, owner)

      expect(copy?.id).toBe(shelf.copyId)
      expect(copy?.canRequest).toBe(true)

      // Капабіліті — це передбачення відповіді сервера. Тест звіряє його з
      // реальним POST, інакше воно розійшлося б із `LoanService` непомітно.
      await requestLoan(app, borrower, shelf.copyId).expect(201)
    })

    it('OWNER бачить свою полицю, але canRequest = false', async () => {
      // §9: власник бачить свою бібліотеку завжди, тож роль OWNER на цьому
      // маршруті цілком реальна — і кнопка дала б 400 LOAN_SELF.
      const owner = await registerAccount(app, 'cap-owner')
      const shelf = await createShelfCopy(app, owner)
      const [copy] = await copiesFor(owner, owner)

      expect(copy?.canRequest).toBe(false)

      const refused = await requestLoan(app, owner, shelf.copyId).expect(400)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_SELF)
    })

    it('OTHER бачить PUBLIC-полицю, але canRequest = false', async () => {
      // Найважливіший випадок: примірник видно, статус AVAILABLE — і саме тут
      // рішення «за статусом» намалювало б кнопку, що дає 403.
      const owner = await registerAccount(app, 'cap-owner')
      const stranger = await registerAccount(app, 'cap-stranger')

      await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', owner.cookie)
        .send({ libraryVisibility: 'PUBLIC' })
        .expect(200)

      const shelf = await createShelfCopy(app, owner, 'PUBLIC')
      const [copy] = await copiesFor(stranger, owner)

      expect(copy?.status).toBe('AVAILABLE')
      expect(copy?.canRequest).toBe(false)

      const refused = await requestLoan(app, stranger, shelf.copyId).expect(403)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.FORBIDDEN)
    })

    it('BLOCKED не бачить полиці взагалі — питання про кнопку не виникає', async () => {
      const owner = await registerAccount(app, 'cap-owner')
      const blocked = await registerAccount(app, 'cap-blocked')

      await befriend(app, owner, blocked)

      const shelf = await createShelfCopy(app, owner, 'PUBLIC')

      await request(app.getHttpServer())
        .post(url(`/friends/${blocked.id}/block`))
        .set('Cookie', owner.cookie)
        .expect(204)

      await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', blocked.cookie)
        .expect(403)

      const refused = await requestLoan(app, blocked, shelf.copyId).expect(403)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
    })

    it('після власного запиту canRequest стає false — попри AVAILABLE', async () => {
      const { owner, borrower, shelf } = await pair()

      await requestLoan(app, borrower, shelf.copyId).expect(201)

      const [copy] = await copiesFor(borrower, owner)

      expect(copy?.status).toBe('AVAILABLE')
      expect(copy?.canRequest).toBe(false)

      const refused = await requestLoan(app, borrower, shelf.copyId).expect(409)

      expect(codeOf(refused.body)).toBe(API_ERROR_CODES.LOAN_DUPLICATE_REQUEST)
    })

    it('чужий запит на той самий примірник кнопку не забирає (§5.2)', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'cap-rival')

      await befriend(app, owner, rival)
      await requestLoan(app, borrower, shelf.copyId).expect(201)

      const [copy] = await copiesFor(rival, owner)

      expect(copy?.canRequest).toBe(true)
      await requestLoan(app, rival, shelf.copyId).expect(201)
    })

    it('зайнятий примірник кнопки не має', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'cap-rival')

      await befriend(app, owner, rival)
      await approvedLoan(app, owner, borrower, shelf.copyId)

      const [copy] = await copiesFor(rival, owner)

      expect(copy?.status).toBe('RESERVED')
      expect(copy?.canRequest).toBe(false)
    })
  })

  describe('орієнтовна дата повернення (§6.5)', () => {
    async function copyFor(viewer: Account, owner: Account, copyId: string) {
      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', viewer.cookie)
        .expect(200)

      const parsed = visibleLibraryResponseSchema.parse(response.body)

      return {
        copy: parsed.groups.flatMap((group) => group.copies).find((item) => item.id === copyId),
        raw: response.text,
      }
    }

    it('RESERVED і LENT_OUT показують дату, вказану власником', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'due-rival')

      await befriend(app, owner, rival)

      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      await actOnLoan(app, owner, loanId, { action: 'approve', dueAt: '2026-12-31' }).expect(200)

      const reserved = await copyFor(rival, owner, shelf.copyId)

      expect(reserved.copy?.status).toBe('RESERVED')
      expect(reserved.copy?.expectedReturnAt).toBe('2026-12-31')

      await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(200)

      const lent = await copyFor(rival, owner, shelf.copyId)

      expect(lent.copy?.status).toBe('LENT_OUT')
      expect(lent.copy?.expectedReturnAt).toBe('2026-12-31')
    })

    it('без указаної дати лишається null — §6.5 каже «якщо власник її вказав»', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'due-rival')

      await befriend(app, owner, rival)
      await approvedLoan(app, owner, borrower, shelf.copyId)

      const { copy } = await copyFor(rival, owner, shelf.copyId)

      expect(copy?.status).toBe('RESERVED')
      expect(copy?.expectedReturnAt).toBeNull()
    })

    it('вільний примірник дати не має', async () => {
      const { owner, borrower, shelf } = await pair()
      const { copy } = await copyFor(borrower, owner, shelf.copyId)

      expect(copy?.expectedReturnAt).toBeNull()
    })

    it('разом із датою не витікає ані позичальник, ані id лоану', async () => {
      // §6.6: дата — факт про книжку, а не про людину, тож вона видима навіть із
      // вимкненим showHolderNames. Але саме тому поле мусить бути голою датою.
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'due-rival')

      await befriend(app, owner, rival)

      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      await actOnLoan(app, owner, loanId, { action: 'approve', dueAt: '2026-12-31' }).expect(200)
      await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(200)

      await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', owner.cookie)
        .send({ showHolderNames: false })
        .expect(200)

      const { copy, raw } = await copyFor(rival, owner, shelf.copyId)

      expect(copy?.expectedReturnAt).toBe('2026-12-31')
      // Ім'я приховане — а дата лишилася.
      expect(copy?.holder).toBeNull()

      // Сире тіло: розібране схемою сховало б витік саме там, де його треба
      // побачити.
      expect(raw).not.toContain(loanId)
      expect(raw).not.toContain(borrower.id)
      expect(raw).not.toContain(borrower.displayName)
      expect(raw).not.toContain('borrowerId')
      expect(raw).not.toContain('dueAt')
    })
  })

  describe('стан кнопки «Попросити» (§6.5)', () => {
    it('після запиту примірник лишається AVAILABLE, але myActiveLoan заповнений', async () => {
      // Саме тому кнопка не може вирішувати за `Copy.status`: за §5.1 запит
      // примірника не змінює, і рішення за статусом дозволило б натиснути вдруге.
      const { owner, borrower, shelf } = await pair()
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = loanResponseSchema.parse(created.body).loan.id

      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', borrower.cookie)
        .expect(200)

      const copies = (
        response.body as {
          groups: {
            copies: { id: string; status: string; myActiveLoan: { id: string } | null }[]
          }[]
        }
      ).groups.flatMap((group) => group.copies)
      const copy = copies.find((item) => item.id === shelf.copyId)

      expect(copy?.status).toBe('AVAILABLE')
      expect(copy?.myActiveLoan).toEqual({ id: loanId, status: 'REQUESTED' })
    })

    it('гість не бачить чужої черги, власник бачить її числом', async () => {
      const { owner, borrower, shelf } = await pair()
      const rival = await registerAccount(app, 'rival')

      await befriend(app, owner, rival)
      await requestLoan(app, borrower, shelf.copyId).expect(201)
      await requestLoan(app, rival, shelf.copyId).expect(201)

      const guest = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', borrower.cookie)
        .expect(200)

      // Сире тіло: розібране схемою сховало б зайве поле саме там, де його треба
      // побачити.
      expect(JSON.stringify(guest.body)).not.toContain('pendingRequestCount')

      const own = await request(app.getHttpServer())
        .get(url('/me/library'))
        .set('Cookie', owner.cookie)
        .expect(200)

      const ownCopies = (
        own.body as { groups: { copies: { id: string; pendingRequestCount: number }[] }[] }
      ).groups.flatMap((group) => group.copies)

      expect(ownCopies.find((item) => item.id === shelf.copyId)?.pendingRequestCount).toBe(2)
    })

    it('«чужі в мене» веде на лоан, яким книжка туди потрапила', async () => {
      const { owner, borrower, shelf } = await pair()
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      const response = await request(app.getHttpServer())
        .get(url('/me/library/borrowed'))
        .set('Cookie', borrower.cookie)
        .expect(200)

      const copies = (
        response.body as {
          groups: { copies: { id: string; activeLoan: { id: string; status: string } | null }[] }[]
        }
      ).groups.flatMap((group) => group.copies)

      expect(copies.find((item) => item.id === shelf.copyId)?.activeLoan).toEqual({
        id: loanId,
        status: 'HANDED_OVER',
      })
    })
  })
})
