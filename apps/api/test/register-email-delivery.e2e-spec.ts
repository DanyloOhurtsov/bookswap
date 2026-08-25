import 'reflect-metadata'
import request from 'supertest'
import { sessionResponseSchema } from '@bookswap/shared'
import { createTestApp, uniqueEmail, VALID_PASSWORD } from './auth.helpers'
import { url } from './loan.helpers'
import { EMAIL_SENDER } from '../src/email/email-sender'
import { PrismaService } from '../src/prisma/prisma.service'
import type { EmailMessage, EmailSender } from '../src/email/email-sender'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * §7.2 і аудит етапу 6: лист підтвердження адреси надсилається ПІСЛЯ того, як
 * User уже закомічений, тож збій чи затримка провайдера на цьому кроці не
 * повинні псувати вже успішну реєстрацію.
 *
 * Два різні ризики, дві групи тестів:
 *
 * 1. Провайдер ВІДПОВІДАЄ помилкою (429/5xx) — реєстрація все одно мусить дати
 *    201 із сесією. Якби `sendEmailVerification` кидала назовні, клієнт
 *    отримав би 500 на адресу, яка вже назавжди зайнята (User уже в БД) — ні
 *    зареєструватися повторно, ні второпати, що акаунт узагалі створився.
 * 2. Провайдер ВИСИТЬ (не відповідає ні успіхом, ні помилкою) — відповідь
 *    ендпоінту все одно мусить повернутися одразу, а не за секунди мережевого
 *    таймауту. Лист іде у фоні (`workflow.enqueueEmail`, без `await`), тож HTTP-
 *    відповідь ніяк не залежить від того, коли (і чи взагалі) провайдер
 *    відповість.
 */
describe('Реєстрація не залежить від провайдера пошти (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService

  const email = {
    sent: [] as EmailMessage[],
    fail: null as Error | null,
    hang: null as { promise: Promise<void>; resolve: () => void } | null,
  }

  const emailSender: EmailSender = {
    send(message) {
      if (email.hang !== null) {
        return email.hang.promise.then(() => {
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
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    email.sent.length = 0
    email.fail = null
    email.hang = null
  })

  function registerRequest(address: string): request.Test {
    return request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email: address, password: VALID_PASSWORD, displayName: 'Нова Людина' })
  }

  it('успішний провайдер: лист іде одразу разом із реєстрацією', async () => {
    const address = uniqueEmail('register-ok')

    await registerRequest(address).expect(201)

    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)
  })

  /** Головна перевірка №1: збій провайдера не перетворює 201 на 500. */
  it('провайдер відповідає 5xx — реєстрація все одно дає 201 із сесією', async () => {
    const address = uniqueEmail('register-fail')

    email.fail = new Error('Resend: 500 Internal Server Error')

    const response = await registerRequest(address).expect(201)

    const parsed = sessionResponseSchema.parse(response.body)
    expect(parsed.user.email).toBe(address)
    expect(parsed.user.emailVerified).toBe(false)

    // Акаунт справді створений — і рівно один раз: повторна реєстрація тим
    // самим email дає EMAIL_TAKEN, а не ще один шанс "почати заново".
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } })
    expect(user.id).toBe(parsed.user.id)
  })

  /**
   * Відновлення після збою: токен підтвердження все одно записаний у БД
   * (сам HTTP-виклик `email.send` — це те, що впало, а не запис токена), тож
   * "Надіслати ще раз" одразу працює на здоровому провайдері.
   */
  it('після збою провайдера "надіслати ще раз" все одно надсилає лист', async () => {
    const address = uniqueEmail('register-fail-resend')

    email.fail = new Error('Resend: 429 Too many requests')

    const response = await registerRequest(address).expect(201)
    const cookie = String(response.headers['set-cookie']).split(';')[0] ?? ''

    email.fail = null
    email.sent.length = 0

    await request(app.getHttpServer())
      .post(url('/auth/email-verification'))
      .set('Cookie', cookie)
      .expect(202)

    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)
  })

  /** Головна перевірка №2: відповідь не чекає на провайдер, що завис. */
  it('провайдер, що завис, не затримує відповідь реєстрації', async () => {
    const address = uniqueEmail('register-hang')

    let resolveHang!: () => void
    const hangPromise = new Promise<void>((resolve) => {
      resolveHang = resolve
    })
    email.hang = { promise: hangPromise, resolve: resolveHang }

    const response = await registerRequest(address).expect(201)

    // Відповідь уже прийшла — і, оскільки гейт ще не відпущено, лист фізично
    // не міг устигнути "надіслатися": якби `register()` чекав на
    // `email.send(...)`, цей `await` сам по собі не повернувся б.
    expect(email.sent).toHaveLength(0)

    const parsed = sessionResponseSchema.parse(response.body)
    expect(parsed.user.email).toBe(address)

    // Прибираємо за собою: відпускаємо гейт і чекаємо ту саму обіцянку, яку
    // тримає внутрішній `.then()` мок-сендера — реакції на один Promise
    // виконуються в порядку реєстрації, тож після цього `push` гарантовано
    // вже стався.
    email.hang = null
    resolveHang()
    await hangPromise

    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]?.to).toBe(address)
  })
})
