import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  meSchema,
  userSearchResponseSchema,
} from '@bookswap/shared'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'

describe('Профіль і пошук людей (e2e)', () => {
  let app: INestApplication<App>

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  async function register(displayName: string): Promise<{ cookie: string; email: string }> {
    const email = uniqueEmail('profile')
    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email, password: VALID_PASSWORD, displayName })
      .expect(201)

    return { cookie: sessionCookie(response.headers), email }
  }

  describe('доступ без сесії', () => {
    it.each([
      ['GET', '/me'],
      ['PATCH', '/me'],
      ['GET', '/users?q=Марта'],
    ])('%s %s без кукі — 401 з машиночитним code', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method === 'GET' ? 'get' : 'patch'](url(path))
        .send(method === 'PATCH' ? { bio: 'спроба' } : undefined)
        .expect(401)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.UNAUTHORIZED)
    })
  })

  describe('GET /me', () => {
    it('віддає повний профіль власника за контрактом', async () => {
      const { cookie, email } = await register('Марта Крук')

      const response = await request(app.getHttpServer())
        .get(url('/me'))
        .set('Cookie', cookie)
        .expect(200)

      const me = meSchema.parse(response.body)

      expect(me.email).toBe(email)
      expect(me.displayName).toBe('Марта Крук')
      expect(me.showHolderNames).toBe(true)
      expect(JSON.stringify(response.body)).not.toContain('passwordHash')
    })
  })

  describe('PATCH /me', () => {
    it('змінює всі п’ять полів §6.1', async () => {
      const { cookie } = await register('Олесь')

      const response = await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', cookie)
        .send({
          displayName: 'Олесь Гнатюк',
          avatarUrl: 'https://cdn.example.com/oles.png',
          bio: 'Читаю фантастику',
          libraryVisibility: 'PUBLIC',
          showHolderNames: false,
        })
        .expect(200)

      expect(meSchema.parse(response.body)).toMatchObject({
        displayName: 'Олесь Гнатюк',
        avatarUrl: 'https://cdn.example.com/oles.png',
        bio: 'Читаю фантастику',
        libraryVisibility: 'PUBLIC',
        showHolderNames: false,
      })
    })

    it('дозволяє занулити аватарку й біо', async () => {
      const { cookie } = await register('Богдан')

      await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', cookie)
        .send({ avatarUrl: 'https://cdn.example.com/b.png', bio: 'Текст' })
        .expect(200)

      const response = await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', cookie)
        .send({ avatarUrl: null, bio: null })
        .expect(200)

      expect(meSchema.parse(response.body)).toMatchObject({ avatarUrl: null, bio: null })
    })

    it('не дає змінити email чи emailVerified через профіль', async () => {
      const { cookie, email } = await register('Ярина')

      // whitelist + forbidNonWhitelisted: невідоме поле це помилка, а не тиха втрата.
      const response = await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', cookie)
        .send({ email: 'inshyj@example.com', emailVerified: true })
        .expect(400)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)

      const me = await request(app.getHttpServer())
        .get(url('/me'))
        .set('Cookie', cookie)
        .expect(200)

      expect(meSchema.parse(me.body).email).toBe(email)
    })

    it('відхиляє порожнє тіло — 200 на «нічого не змінив» був би брехнею', async () => {
      const { cookie } = await register('Порожній')

      const response = await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', cookie)
        .send({})
        .expect(400)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    })

    it('відхиляє невідоме значення видимості', async () => {
      const { cookie } = await register('Видимість')

      await request(app.getHttpServer())
        .patch(url('/me'))
        .set('Cookie', cookie)
        .send({ libraryVisibility: 'SECRET' })
        .expect(400)
    })
  })

  describe('GET /users', () => {
    it('шукає за частиною імені без урахування регістру', async () => {
      const { cookie } = await register('Шукач')
      await register('Северин Наливайко')

      const response = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ q: 'северин' })
        .set('Cookie', cookie)
        .expect(200)

      const { users } = userSearchResponseSchema.parse(response.body)

      expect(users.map((user) => user.displayName)).toContain('Северин Наливайко')
    })

    it('віддає лише імʼя та аватар — §9, «Інший»', async () => {
      const { cookie } = await register('Спостерігач')
      await register('Оксана Приватна')

      const response = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ q: 'Оксана Приватна' })
        .set('Cookie', cookie)
        .expect(200)

      expect(
        Object.keys(userSearchResponseSchema.parse(response.body).users[0] ?? {}).sort(),
      ).toEqual(['avatarUrl', 'displayName', 'id'])
    })

    it('за email знаходить лише при точному збігу', async () => {
      const { cookie } = await register('Точний')
      const { email } = await register('Знайдений')

      const exact = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ email })
        .set('Cookie', cookie)
        .expect(200)

      expect(userSearchResponseSchema.parse(exact.body).users).toHaveLength(1)

      // Префікс адреси не має знаходити нікого — інакше пошту можна перебрати
      // по літері, і §6.1 «за email тільки точний збіг» перестає щось означати.
      const [local, domain] = email.split('@')
      const partial = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ email: `${(local ?? '').slice(0, -1)}@${domain ?? ''}` })
        .set('Cookie', cookie)
        .expect(200)

      expect(userSearchResponseSchema.parse(partial.body).users).toHaveLength(0)
    })

    it('email порівнюється без урахування регістру — так само, як при реєстрації', async () => {
      const { cookie } = await register('Регістр')
      const { email } = await register('Верхній')

      const response = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ email: email.toUpperCase() })
        .set('Cookie', cookie)
        .expect(200)

      expect(userSearchResponseSchema.parse(response.body).users).toHaveLength(1)
    })

    it('не показує самого себе', async () => {
      const { cookie, email } = await register('Самотній Унікум')

      const byName = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ q: 'Самотній Унікум' })
        .set('Cookie', cookie)
        .expect(200)

      const byEmail = await request(app.getHttpServer())
        .get(url('/users'))
        .query({ email })
        .set('Cookie', cookie)
        .expect(200)

      expect(userSearchResponseSchema.parse(byName.body).users).toHaveLength(0)
      expect(userSearchResponseSchema.parse(byEmail.body).users).toHaveLength(0)
    })

    it('вимагає рівно один параметр', async () => {
      const { cookie } = await register('Параметри')

      for (const query of [{}, { q: 'Мар', email: 'a@b.co' }]) {
        const response = await request(app.getHttpServer())
          .get(url('/users'))
          .query(query)
          .set('Cookie', cookie)
          .expect(400)

        expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
      }
    })

    it('не шукає за одним символом', async () => {
      const { cookie } = await register('Односимвольний')

      await request(app.getHttpServer())
        .get(url('/users'))
        .query({ q: 'М' })
        .set('Cookie', cookie)
        .expect(400)
    })
  })
})
