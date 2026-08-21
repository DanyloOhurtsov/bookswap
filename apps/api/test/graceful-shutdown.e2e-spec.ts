import 'reflect-metadata'
import request from 'supertest'
import { createTestApp, uniqueEmail, VALID_PASSWORD } from './auth.helpers'
import { befriend, createShelfCopy, handedOverLoan, registerAccount, url } from './loan.helpers'
import { EMAIL_SENDER } from '../src/email/email-sender'
import { NotificationDigestService } from '../src/notifications/notification-digest.service'
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher.service'
import { NotificationsService } from '../src/notifications/notifications.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { EmailMessage, EmailSender } from '../src/email/email-sender'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

const DAY_MS = 24 * 60 * 60_000

/** Обіцянка, якою керує тест: жодних `sleep`, лише явні сигнали. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })

  return { promise, resolve }
}

interface Gate {
  entered: ReturnType<typeof deferred>
  release: ReturnType<typeof deferred>
}

const gate = (): Gate => ({ entered: deferred(), release: deferred() })

/**
 * §7.3 дефекту: попередні раунди перевіряли `onModuleDestroy()` викликом
 * НАПРЯМУ на сервіс — і це доводило, що метод сам собою написаний правильно,
 * але НЕ доводило, що реальний застосунок узагалі його викличе. `main.ts` не
 * підключав `app.enableShutdownHooks()`, тож на SIGTERM/SIGINT Nest НІКОЛИ не
 * запускав `onModuleDestroy()` — процес просто зникав. Тести тут піднімають
 * СПРАВЖНІЙ `INestApplication` і чекають на `app.close()` (те саме, що
 * зрештою робить хук на сигнал), а не на прямий виклик сервісу.
 *
 * Кожен тест піднімає ОКРЕМИЙ застосунок (бо `close()` незворотний) і сам
 * його закриває; спільний `verifyApp` — окреме, завжди відкрите з'єднання до
 * тієї самої тестової бази, яким читається стан ПІСЛЯ того, як застосунок під
 * тестом уже закрився (а разом з ним і його власний Prisma-клієнт).
 *
 * Взаємодія auth-workflow із двофазним gate'ом (кого shutdown відхиляє, а кого
 * дочікує) перевіряється окремо — `auth-shutdown-reservation.e2e-spec.ts`.
 */
describe('Graceful shutdown реальної Nest application (e2e)', () => {
  let verifyApp: INestApplication<App>
  let prisma: PrismaService

  beforeAll(async () => {
    verifyApp = await createTestApp()
    prisma = verifyApp.get(PrismaService)
  })

  afterAll(async () => {
    await verifyApp.close()
  })

  it('app.close() чекає активний auth-email job', async () => {
    const email = { gate: null as Gate | null }
    const emailSender: EmailSender = {
      send(_message) {
        if (email.gate !== null) {
          const g = email.gate

          g.entered.resolve()

          return g.release.promise
        }

        return Promise.resolve()
      },
    }

    const app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(EMAIL_SENDER).useValue(emailSender)
      },
    })

    let closedByTest = false

    try {
      const address = uniqueEmail('shutdown-auth')
      const g = gate()

      email.gate = g

      await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: address, password: VALID_PASSWORD, displayName: 'Shutdown' })
        .expect(201)

      // Реєстрація вже відповіла — фонове auth-завдання (§7.3 попереднього
      // раунду) щойно дійшло до провайдера.
      await g.entered.promise

      let closed = false
      const closing = app.close().then(() => {
        closed = true
      })

      // Гейт іще тримає лист — реальний app.close() не має права завершитися
      // раніше, ніж AuthService.onModuleDestroy() дочекається його.
      await Promise.resolve()
      expect(closed).toBe(false)

      email.gate = null
      g.release.resolve()
      await closing
      closedByTest = true

      expect(closed).toBe(true)

      const user = await prisma.user.findUniqueOrThrow({ where: { email: address } })

      expect(user).toBeDefined()
    } finally {
      if (!closedByTest) await app.close().catch(() => undefined)
    }
  })

  it('app.close() чекає активний тик NotificationDispatcher', async () => {
    const email = { sent: [] as EmailMessage[], gate: null as Gate | null }
    const emailSender: EmailSender = {
      send(message) {
        if (email.gate !== null) {
          const g = email.gate

          g.entered.resolve()

          return g.release.promise.then(() => {
            email.sent.push(message)
          })
        }

        email.sent.push(message)

        return Promise.resolve()
      },
    }

    const app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(EMAIL_SENDER).useValue(emailSender)
      },
    })

    let closedByTest = false

    try {
      const appPrisma = app.get(PrismaService)
      const notifications = app.get(NotificationsService)
      const dispatcher = app.get(NotificationDispatcher)

      const account = await registerAccount(app, 'shutdown-dispatch')

      await appPrisma.user.update({
        where: { id: account.id },
        data: { emailVerified: true },
      })
      await appPrisma.notificationPreference.create({
        data: { userId: account.id, type: 'LOAN_REQUESTED', channel: 'IN_APP', enabled: false },
      })

      // registerAccount() уже надіслав лист підтвердження адреси тим самим
      // мок-провайдером — прибираємо його, інакше гейт нижче міг би впіймати
      // саме його замість листа сповіщення.
      email.sent.length = 0

      const g = gate()

      email.gate = g

      await notifications.create({
        userId: account.id,
        type: 'LOAN_REQUESTED',
        payload: { loanId: 'shutdown-loan', copyId: 'shutdown-copy' },
      })

      dispatcher.wake()

      await g.entered.promise

      let closed = false
      const closing = app.close().then(() => {
        closed = true
      })

      await Promise.resolve()
      expect(closed).toBe(false)

      email.gate = null
      g.release.resolve()
      await closing
      closedByTest = true

      expect(closed).toBe(true)
      expect(email.sent).toHaveLength(1)

      const delivery = await prisma.notificationDelivery.findFirstOrThrow({
        where: { notification: { userId: account.id }, channel: 'EMAIL' },
      })

      expect(delivery.status).toBe('SENT')
    } finally {
      if (!closedByTest) await app.close().catch(() => undefined)
    }
  })

  it('app.close() чекає активний прохід NotificationDigestService', async () => {
    const app = await createTestApp()
    let closedByTest = false

    try {
      const appPrisma = app.get(PrismaService)
      const notifications = app.get(NotificationsService)
      const digest = app.get(NotificationDigestService)

      const owner = await registerAccount(app, 'shutdown-digest-owner')
      const borrower = await registerAccount(app, 'shutdown-digest-borrower')

      await befriend(app, owner, borrower)

      const shelf = await createShelfCopy(app, owner)
      const loanId = await handedOverLoan(app, owner, borrower, shelf.copyId)

      const now = new Date()

      await appPrisma.loan.update({
        where: { id: loanId },
        data: { dueAt: new Date(now.getTime() + 3 * DAY_MS) },
      })

      const barrier = gate()
      const originalCreate = notifications.create.bind(notifications)
      const spy = jest.spyOn(notifications, 'create').mockImplementation(async (input, client) => {
        if (input.userId !== borrower.id) return originalCreate(input, client)

        barrier.entered.resolve()
        await barrier.release.promise

        return originalCreate(input, client)
      })

      digest.wake()

      await barrier.entered.promise

      let closed = false
      const closing = app.close().then(() => {
        closed = true
      })

      await Promise.resolve()
      expect(closed).toBe(false)

      barrier.release.resolve()
      await closing
      closedByTest = true

      spy.mockRestore()

      expect(closed).toBe(true)

      const events = await prisma.notification.findMany({
        where: { userId: borrower.id, type: 'LOAN_DUE_SOON' },
      })

      expect(events).toHaveLength(1)
    } finally {
      if (!closedByTest) await app.close().catch(() => undefined)
    }
  }, 15_000)
})
