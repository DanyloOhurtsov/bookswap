import 'reflect-metadata'
import request from 'supertest'
import { createTestApp, uniqueEmail, VALID_PASSWORD } from './auth.helpers'
import { url } from './loan.helpers'
import { AuthService } from '../src/auth/auth.service'
import { EMAIL_SENDER } from '../src/email/email-sender'
import { PrismaService } from '../src/prisma/prisma.service'
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
  /** Спрацьовує, щойно мок-провайдер справді увійшов у `send()`. */
  entered: ReturnType<typeof deferred>
  /** Тест відпускає провайдера, коли захоче. */
  release: ReturnType<typeof deferred>
}

/**
 * §6.1: відповідь на запит скидання пароля не має залежати від того, чи
 * зареєстрована адреса.
 *
 * Гілку «невідома адреса» видно одразу, і вона правильна: 202 без звернення до
 * пошти. Небезпечна — друга: **відома** адреса, на якій провайдер відповів 429
 * або 5xx. Якщо ця різниця доїжджає до клієнта, ендпоінт перетворюється на
 * перевірку «чи є такий акаунт»: досить дочекатися, коли Resend почне обмежувати
 * частоту, і далі 500 означає «зареєстрований», а 202 — «ні». Rate limiting §11
 * від цього не рятує: він обмежує швидкість перебору, а не сам факт витоку.
 *
 * Дефект 8 (другий раунд аудиту): навіть без мережевої затримки лишався
 * зайвий `INSERT` (`passwordResetToken.create`) У ШЛЯХУ ЗАПИТУ для відомої
 * адреси — невідома його не робила взагалі. `AuthService.requestPasswordReset`
 * тепер лише бере дозвіл на workflow і реєструє фонове завдання
 * (`workflow.enqueueEmail`), не чекаючи на нього: увесь обробіток, і відомий,
 * і невідомий, однаково не впливає на час відповіді.
 */
describe('Скидання пароля не видає наявність акаунта (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let auth: AuthService

  /** Керований провайдер: падає або зависає рівно тоді, коли тест цього хоче. */
  const email = {
    sent: [] as EmailMessage[],
    fail: null as Error | null,
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

      if (email.fail !== null) return Promise.reject(email.fail)

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

    prisma = app.get(PrismaService)
    auth = app.get(AuthService)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    email.sent.length = 0
    email.fail = null
    email.gate = null
  })

  // Ізоляція тестів: фонове завдання, яке тест не дочекався явно (бо його
  // конкретна перевірка того не вимагала), не має долітати до НАСТУПНОГО
  // тесту й псувати його `email.sent`/`email.fail`, зафіксовані вже по-новому
  // в `beforeEach`.
  afterEach(async () => {
    await auth.drainBackgroundWork()
  })

  /**
   * `requestPasswordReset()` тепер повертається, щойно фонове завдання
   * зареєстроване, — синхронна частина шляху запиту НЕ включає навіть пошук
   * `User` у базі. Тести, яким потрібен РЕЗУЛЬТАТ обробки (лист у
   * `email.sent`, рядок токена в БД), мусять дочекатися завдання явно — тим
   * самим гаком, яким користується `onModuleDestroy`, а не `sleep`.
   */
  const settle = async (): Promise<void> => auth.drainBackgroundWork()

  async function register(prefix: string): Promise<string> {
    const address = uniqueEmail(prefix)

    await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email: address, password: VALID_PASSWORD, displayName: 'Скидання' })
      .expect(201)

    return address
  }

  function requestReset(address: string): request.Test {
    return request(app.getHttpServer()).post(url('/auth/password-reset')).send({ email: address })
  }

  it('невідома адреса дає 202', async () => {
    await requestReset(uniqueEmail('reset-unknown')).expect(202)
  })

  it('відома адреса дає 202', async () => {
    const address = await register('reset-known')

    email.sent.length = 0

    await requestReset(address).expect(202)
    await settle()

    expect(email.sent).toHaveLength(1)
  })

  /**
   * Головна перевірка файлу: збій провайдера на **відомій** адресі не має
   * відрізнятися від успіху на невідомій.
   */
  it('збій провайдера на відомій адресі теж дає 202', async () => {
    const address = await register('reset-provider-down')

    email.fail = new Error('Resend: 429 Too many requests')

    await requestReset(address).expect(202)
  })

  /**
   * Аудит етапу 6, дефект 8: раніше відома адреса чекала на `await
   * this.email.send(...)` — до REQUEST_TIMEOUT_MS провайдера на кожен виклик,
   * тоді як невідома адреса поверталася миттєво. Провайдер, що просто ЗАВИС
   * (ні успіх, ні помилка), — найчистіший спосіб це довести.
   *
   * Гейт тут — повноцінний `entered`/`release`, а не сирий проміс: `send()`
   * тепер викликається лише ПІСЛЯ реального пошуку `User` і запису токена в
   * БД (справжній асинхронний round-trip), тож відпускати гейт одразу після
   * HTTP-відповіді — зарано, `send()` до цього моменту ще навіть не встиг
   * стартувати. `entered` доводить, що виклик справді стався, а сам факт, що
   * рядок з `expect(202)` унизу взагалі повернувся, ДОКИ гейт ще не
   * відпущений, — і є доказом: якби відповідь чекала на `send()`, цей рядок
   * повис би назавжди (тест впав би по таймауту), а не мовчки пройшов з
   * порожнім `email.sent`.
   */
  it('провайдер, що завис, не затримує відповідь на скидання пароля', async () => {
    const address = await register('reset-hang')

    // `register()` теж надсилає лист (підтвердження адреси) тим самим
    // фоновим шляхом — не дочекавшись його завершення тут, гейт нижче міг би
    // випадково впіймати САМЕ цей лист замість листа скидання пароля.
    await settle()
    email.sent.length = 0

    const gate: Gate = { entered: deferred(), release: deferred() }

    email.gate = gate

    await requestReset(address).expect(202)

    // Доводимо, що фонове завдання СПРАВДІ дійшло до виклику провайдера.
    await gate.entered.promise

    email.gate = null
    gate.release.resolve()

    await settle()

    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)
  })

  /**
   * Чотири випадки, не три: невідома адреса, відома зі здоровим провайдером,
   * відома з провайдером, що падає, і відома з провайдером, що просто ЗАВИС.
   * Останній перевіряється окремо, бо він єдиний, чия відповідь тепер летить
   * ще ДО того, як фонове завдання взагалі торкнулося БД чи мережі — якби
   * десь у коді лишився хоч один зайвий `await` на цьому шляху, саме тут це
   * було б найпростіше випадково зламати знову.
   */
  it('відповіді на всі чотири випадки нерозрізненні', async () => {
    const known = await register('reset-compare')
    const unknown = uniqueEmail('reset-compare-unknown')

    email.sent.length = 0

    const okKnown = await requestReset(known).expect(202)
    await settle()

    email.fail = new Error('Resend: 503 Service unavailable')

    const failingKnown = await requestReset(known).expect(202)
    await settle()

    email.fail = null

    const okUnknown = await requestReset(unknown).expect(202)
    await settle()

    const gate: Gate = { entered: deferred(), release: deferred() }

    email.gate = gate

    const hangingKnown = await requestReset(known).expect(202)

    await gate.entered.promise
    email.gate = null
    gate.release.resolve()
    await settle()

    // Однаковий статус і однакове тіло в усіх чотирьох — інакше різницю видно
    // навіть без вимірювання часу.
    for (const response of [failingKnown, okUnknown, hangingKnown]) {
      expect(response.status).toBe(okKnown.status)
      expect(JSON.stringify(response.body)).toBe(JSON.stringify(okKnown.body))
    }
  })

  /**
   * Токен створюється **до** відправки, тож збій провайдера не лишає людину без
   * виходу: повторна спроба (уже на здоровому провайдері) надішле лист.
   */
  it('після збою провайдера повторна спроба надсилає лист', async () => {
    const address = await register('reset-retry')

    email.fail = new Error('Resend: 500')
    await requestReset(address).expect(202)
    await settle()

    email.sent.length = 0
    email.fail = null

    await requestReset(address).expect(202)
    await settle()

    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)

    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } })

    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(2)
  })
})
