import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  sessionResponseSchema,
} from '@bookswap/shared'
import { AuthService } from '../src/auth/auth.service'
import { DevEmailSender } from '../src/email/dev-email-sender'
import { PrismaService } from '../src/prisma/prisma.service'
import { hashToken } from '../src/auth/tokens'
import {
  VALID_PASSWORD,
  cookiesOf,
  createTestApp,
  sessionCookie,
  tokenFromLastEmail,
  uniqueEmail,
} from './auth.helpers'

describe('Auth (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let email: DevEmailSender
  let auth: AuthService

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    email = app.get(DevEmailSender)
    auth = app.get(AuthService)
  })

  afterAll(async () => {
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  /**
   * `requestPasswordReset()` тепер лише реєструє фонове завдання й
   * повертається одразу (§6.1/дефект 8 другого раунду аудиту): лист із
   * токеном ще не гарантовано в `DevEmailSender` в момент, коли HTTP-
   * відповідь уже прийшла. Тести, яким потрібен сам токен, чекають завдання
   * цим гаком — тим самим, яким користується `onModuleDestroy`.
   */
  const settle = async (): Promise<void> => auth.drainBackgroundWork()

  async function register(
    address = uniqueEmail(),
    password = VALID_PASSWORD,
  ): Promise<{ address: string; cookie: string; id: string }> {
    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email: address, password, displayName: 'Тестовий Користувач' })
      .expect(201)

    return {
      address,
      cookie: sessionCookie(response.headers),
      id: sessionResponseSchema.parse(response.body).user.id,
    }
  }

  describe('реєстрація', () => {
    it('створює акаунт, ставить сесію й повертає профіль без пароля', async () => {
      const address = uniqueEmail()
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: address, password: VALID_PASSWORD, displayName: '  Марта  ' })
        .expect(201)

      const { user } = sessionResponseSchema.parse(response.body)

      expect(user.email).toBe(address)
      expect(user.displayName).toBe('Марта')
      expect(user.emailVerified).toBe(false)
      expect(user.libraryVisibility).toBe('FRIENDS')
      expect(JSON.stringify(response.body)).not.toContain('passwordHash')
      expect(sessionCookie(response.headers)).toContain('bookswap_session=')
    })

    it('не зберігає пароль у відкритому вигляді', async () => {
      const address = uniqueEmail()
      await register(address)

      const stored = await prisma.user.findUniqueOrThrow({ where: { email: address } })

      expect(stored.passwordHash).not.toContain(VALID_PASSWORD)
      expect(stored.passwordHash.startsWith('scrypt$')).toBe(true)
    })

    it('нормалізує email — регістр не створює другий акаунт', async () => {
      const address = uniqueEmail()
      await register(address)

      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({
          email: address.toUpperCase(),
          password: VALID_PASSWORD,
          displayName: 'Двійник',
        })
        .expect(409)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.EMAIL_TAKEN)
    })

    it('відхиляє закороткий пароль із машиночитним code', async () => {
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: uniqueEmail(), password: 'korot', displayName: 'Марта' })
        .expect(400)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    })

    it('надсилає лист із підтвердженням', async () => {
      const address = uniqueEmail()
      await register(address)

      expect(email.lastTo(address)?.subject).toContain('підтвердіть адресу'.toLowerCase())
    })
  })

  describe('cookie сесії (§6.1)', () => {
    it('httpOnly, SameSite=Lax, Path=/ і без Secure у dev', async () => {
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: uniqueEmail(), password: VALID_PASSWORD, displayName: 'Марта' })
        .expect(201)

      const cookie = cookiesOf(response.headers).find((value) =>
        value.startsWith('bookswap_session='),
      )

      expect(cookie).toBeDefined()
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=Lax/i)
      expect(cookie).toMatch(/Path=\//i)
      // NODE_ENV у тестах не production, тож Secure не ставиться — інакше кукі
      // не дійшла б по http://localhost.
      expect(cookie).not.toMatch(/Secure/i)
    })

    it('у кукі лежить не той рядок, що в базі — там тільки геш', async () => {
      const { cookie } = await register()
      const token = cookie.split('=')[1] ?? ''

      expect(await prisma.session.findUnique({ where: { tokenHash: token } })).toBeNull()
      expect(
        await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
      ).not.toBeNull()
    })
  })

  describe('логін', () => {
    it('пускає з правильним паролем', async () => {
      const { address } = await register()

      const response = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: address, password: VALID_PASSWORD })
        .expect(200)

      expect(sessionResponseSchema.parse(response.body).user.email).toBe(address)
      expect(sessionCookie(response.headers)).toContain('bookswap_session=')
    })

    it('не пускає з неправильним паролем', async () => {
      const { address } = await register()

      const response = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: address, password: 'ne-tsej-parol-2026' })
        .expect(401)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.INVALID_CREDENTIALS)
      expect(cookiesOf(response.headers)).toHaveLength(0)
    })

    it('невідомий email і невірний пароль нерозрізненні', async () => {
      const { address } = await register()

      const wrongPassword = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: address, password: 'ne-tsej-parol-2026' })
        .expect(401)

      const unknownEmail = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: uniqueEmail('nikoho'), password: VALID_PASSWORD })
        .expect(401)

      // Ні код, ні текст не мають підказувати, чи існує акаунт.
      expect(unknownEmail.body).toEqual(wrongPassword.body)
    })
  })

  describe('поточна сесія', () => {
    it('віддає профіль за дійсною кукі', async () => {
      const { cookie, address } = await register()

      const response = await request(app.getHttpServer())
        .get(url('/auth/session'))
        .set('Cookie', cookie)
        .expect(200)

      expect(sessionResponseSchema.parse(response.body).user.email).toBe(address)
    })

    it('без кукі — 401 з машиночитним code', async () => {
      const response = await request(app.getHttpServer()).get(url('/auth/session')).expect(401)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.UNAUTHORIZED)
    })

    it('з підробленою кукі — 401', async () => {
      await request(app.getHttpServer())
        .get(url('/auth/session'))
        .set('Cookie', 'bookswap_session=vygadanyj-token')
        .expect(401)
    })

    it('прострочена сесія не працює', async () => {
      const { cookie } = await register()
      const token = cookie.split('=')[1] ?? ''

      await request(app.getHttpServer()).get(url('/auth/session')).set('Cookie', cookie).expect(200)

      // Відмотуємо термін у минуле — рівно те, що станеться через місяць.
      await prisma.session.update({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })

      await request(app.getHttpServer()).get(url('/auth/session')).set('Cookie', cookie).expect(401)
    })
  })

  describe('logout', () => {
    it('відкликає сесію й гасить кукі', async () => {
      const { cookie } = await register()

      const response = await request(app.getHttpServer())
        .post(url('/auth/logout'))
        .set('Cookie', cookie)
        .expect(204)

      const cleared = cookiesOf(response.headers).find((value) =>
        value.startsWith('bookswap_session='),
      )

      expect(cleared).toMatch(/bookswap_session=;/)
      await request(app.getHttpServer()).get(url('/auth/session')).set('Cookie', cookie).expect(401)
    })

    it('відкликана сесія лишається відкликаною — кукі не «оживає»', async () => {
      const { cookie } = await register()

      await request(app.getHttpServer()).post(url('/auth/logout')).set('Cookie', cookie).expect(204)
      await request(app.getHttpServer()).get(url('/auth/session')).set('Cookie', cookie).expect(401)
      await request(app.getHttpServer()).get(url('/auth/session')).set('Cookie', cookie).expect(401)
    })

    it('працює без сесії — мертву кукі теж треба вміти скинути', async () => {
      await request(app.getHttpServer()).post(url('/auth/logout')).expect(204)
    })
  })

  describe('підтвердження пошти', () => {
    it('токен одноразовий', async () => {
      const address = uniqueEmail()
      await register(address)
      const token = tokenFromLastEmail(email, address)

      const first = await request(app.getHttpServer())
        .post(url('/auth/email-verification/confirm'))
        .send({ token })
        .expect(200)

      expect(sessionResponseSchema.parse(first.body).user.emailVerified).toBe(true)

      const second = await request(app.getHttpServer())
        .post(url('/auth/email-verification/confirm'))
        .send({ token })
        .expect(400)

      expect(apiErrorSchema.parse(second.body).code).toBe(API_ERROR_CODES.INVALID_TOKEN)
    })

    it('прострочений токен не працює', async () => {
      const address = uniqueEmail()
      await register(address)
      const token = tokenFromLastEmail(email, address)

      await prisma.emailVerificationToken.update({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })

      await request(app.getHttpServer())
        .post(url('/auth/email-verification/confirm'))
        .send({ token })
        .expect(400)
    })

    it('вигаданий токен не працює', async () => {
      await request(app.getHttpServer())
        .post(url('/auth/email-verification/confirm'))
        .send({ token: 'vygadanyj' })
        .expect(400)
    })

    it('повторне надсилання потребує сесії', async () => {
      await request(app.getHttpServer()).post(url('/auth/email-verification')).expect(401)
    })
  })

  describe('скидання пароля', () => {
    it('не розкриває, чи зареєстрований email', async () => {
      const { address } = await register()

      const known = await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: address })
        .expect(202)

      const unknown = await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: uniqueEmail('nikoho') })
        .expect(202)

      expect(known.body).toEqual({ accepted: true })
      expect(unknown.body).toEqual(known.body)
    })

    it('токен одноразовий, і після скидання діє новий пароль', async () => {
      const address = uniqueEmail()
      await register(address)

      await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: address })
        .expect(202)
      await settle()

      const token = tokenFromLastEmail(email, address)
      const newPassword = 'zovsim-inshyj-parol-2026'

      await request(app.getHttpServer())
        .post(url('/auth/password-reset/confirm'))
        .send({ token, password: newPassword })
        .expect(204)

      await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: address, password: newPassword })
        .expect(200)

      await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: address, password: VALID_PASSWORD })
        .expect(401)

      const reused = await request(app.getHttpServer())
        .post(url('/auth/password-reset/confirm'))
        .send({ token, password: 'shche-odyn-parol-2026' })
        .expect(400)

      expect(apiErrorSchema.parse(reused.body).code).toBe(API_ERROR_CODES.INVALID_TOKEN)
    })

    it('розлогінює всі сесії — вкрадена кукі перестає діяти', async () => {
      const address = uniqueEmail()
      const { cookie } = await register(address)

      await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: address })
        .expect(202)
      await settle()

      await request(app.getHttpServer())
        .post(url('/auth/password-reset/confirm'))
        .send({ token: tokenFromLastEmail(email, address), password: 'novyj-parol-2026' })
        .expect(204)

      await request(app.getHttpServer()).get(url('/auth/session')).set('Cookie', cookie).expect(401)
    })

    it('гасить і другий, ще не використаний токен', async () => {
      const address = uniqueEmail()
      await register(address)

      await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: address })
        .expect(202)
      await settle()
      const first = tokenFromLastEmail(email, address)

      await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: address })
        .expect(202)
      await settle()
      const second = tokenFromLastEmail(email, address)

      expect(first).not.toBe(second)

      await request(app.getHttpServer())
        .post(url('/auth/password-reset/confirm'))
        .send({ token: second, password: 'novyj-parol-2026' })
        .expect(204)

      // Перший лист лишався б чинним ключем від акаунта ще годину.
      await request(app.getHttpServer())
        .post(url('/auth/password-reset/confirm'))
        .send({ token: first, password: 'shche-odyn-parol-2026' })
        .expect(400)
    })

    it('новий пароль перевіряється за політикою довжини', async () => {
      const address = uniqueEmail()
      await register(address)

      await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: address })
        .expect(202)
      await settle()

      await request(app.getHttpServer())
        .post(url('/auth/password-reset/confirm'))
        .send({ token: tokenFromLastEmail(email, address), password: 'korot' })
        .expect(400)
    })
  })
})
