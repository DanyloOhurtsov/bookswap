import 'reflect-metadata'
import request from 'supertest'
import { createTestApp, uniqueEmail, VALID_PASSWORD } from './auth.helpers'
import { url } from './loan.helpers'
import { AuthService } from '../src/auth/auth.service'
import { EMAIL_SENDER } from '../src/email/email-sender'
import type { EmailMessage, EmailSender } from '../src/email/email-sender'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

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

/**
 * Дефект 8 (другий раунд аудиту): `fireAndForgetEmail` (попередня назва)
 * запускала незареєстрований проміс — `onModuleDestroy` про нього не знав і
 * не чекав. Graceful shutdown (SIGTERM → `app.close()`) міг обірвати процес,
 * поки `email.send()` ще летить, — лист губився не через збій провайдера, а
 * тому що застосунок просто зник раніше.
 *
 * `AuthService` тепер відстежує кожне фонове auth-завдання
 * (`workflow.enqueueEmail` → `activeEmailJobs`), а `onModuleDestroy` чекає їх
 * усі. Тести нижче доводять це для обох джерел фонових листів — підтвердження
 * адреси (`register`) і скидання пароля (`requestPasswordReset`) — гейтом,
 * що зупиняє мок-провайдера рівно всередині виклику, а не `sleep`-ом навколо
 * нього.
 *
 * Тут перевіряється сам факт очікування; те, кого двофазний shutdown відхиляє
 * до мутацій, а кого зобов'язаний довести до кінця, — у
 * `auth-shutdown-reservation.e2e-spec.ts`.
 */
describe('AuthService: graceful shutdown чекає активні auth-email завдання (e2e)', () => {
  let app: INestApplication<App>
  let auth: AuthService

  const email = {
    sent: [] as EmailMessage[],
    gate: null as Gate | null,
  }

  const emailSender: EmailSender = {
    send(message) {
      if (email.gate !== null) {
        const gate = email.gate

        gate.entered.resolve()

        return gate.release.promise.then(() => {
          email.sent.push(message)
        })
      }

      email.sent.push(message)

      return Promise.resolve()
    },
  }

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(EMAIL_SENDER).useValue(emailSender)
      },
    })

    auth = app.get(AuthService)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    email.sent.length = 0
    email.gate = null
  })

  afterEach(async () => {
    // Ізоляція: жодне з цих завдань не має пережити свій тест.
    await auth.drainBackgroundWork()
  })

  it('не завершується, поки триває лист підтвердження адреси (register)', async () => {
    const address = uniqueEmail('shutdown-verify')
    const gate: Gate = { entered: deferred(), release: deferred() }

    email.gate = gate

    await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email: address, password: VALID_PASSWORD, displayName: 'Завершення' })
      .expect(201)

    // Реєстрація вже відповіла — фонове завдання щойно дійшло до провайдера.
    await gate.entered.promise

    let destroyed = false
    const destroying = auth.drainBackgroundWork().then(() => {
      destroyed = true
    })

    // Гейт іще тримає лист — drain не має права завершитися раніше.
    await Promise.resolve()
    expect(destroyed).toBe(false)

    email.gate = null
    gate.release.resolve()
    await destroying

    expect(destroyed).toBe(true)
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)
  })

  it('не завершується, поки триває лист скидання пароля', async () => {
    const address = uniqueEmail('shutdown-reset')

    await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email: address, password: VALID_PASSWORD, displayName: 'Завершення' })
      .expect(201)

    // Лист підтвердження реєстрації йде тим самим фоновим механізмом — не
    // дочекавшись його тут, наступний гейт міг би впіймати саме його.
    await auth.drainBackgroundWork()
    email.sent.length = 0

    const gate: Gate = { entered: deferred(), release: deferred() }

    email.gate = gate

    await request(app.getHttpServer())
      .post(url('/auth/password-reset'))
      .send({ email: address })
      .expect(202)

    await gate.entered.promise

    let destroyed = false
    const destroying = auth.drainBackgroundWork().then(() => {
      destroyed = true
    })

    await Promise.resolve()
    expect(destroyed).toBe(false)

    email.gate = null
    gate.release.resolve()
    await destroying

    expect(destroyed).toBe(true)
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)
  })
})
