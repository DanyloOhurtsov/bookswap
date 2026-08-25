import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import { API_ERROR_CODES, API_PREFIX, apiErrorSchema } from '@bookswap/shared'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'

/**
 * §11, R2: rate limiting на створення Work/Edition. Ліміт і вікно тут навмисно
 * малі — `process.env` читається лінькво, у момент запиту (`common/rate-limit.config.ts`),
 * тож підміна перед підйомом застосунку діє так само, як `.env` у продакшні.
 */
describe('Rate limiting на створення каталогу (e2e)', () => {
  let app: INestApplication<App>
  let cookie: string

  const LIMIT = 3
  const WINDOW_MS = 3000

  beforeAll(async () => {
    process.env.CATALOG_WRITE_RATE_LIMIT = String(LIMIT)
    process.env.CATALOG_WRITE_RATE_WINDOW_MS = String(WINDOW_MS)

    app = await createTestApp({ withRateLimit: true })

    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({
        email: uniqueEmail('catalog-rate-limit'),
        password: VALID_PASSWORD,
        displayName: 'Ліміт',
      })
      .expect(201)

    cookie = sessionCookie(response.headers)
  })

  afterAll(async () => {
    delete process.env.CATALOG_WRITE_RATE_LIMIT
    delete process.env.CATALOG_WRITE_RATE_WINDOW_MS
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  let sequence = 0

  function marker(): string {
    sequence += 1

    return `лімітник${String(process.pid)}${String(sequence)}`
  }

  function createWorkPayload(): Record<string, unknown> {
    const token = marker()

    return {
      title: `Твір ${token}`,
      origLang: 'uk',
      authors: [{ name: `Автор ${token}` }],
    }
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  it(`${String(LIMIT + 1)}-й запит POST /works у вікні — 429, після вікна знову проходить`, async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .post(url('/works'))
        .set('Cookie', cookie)
        .send(createWorkPayload())
        .expect(201)
    }

    const blocked = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', cookie)
      .send(createWorkPayload())
      .expect(429)

    expect(apiErrorSchema.parse(blocked.body).code).toBe(API_ERROR_CODES.TOO_MANY_REQUESTS)

    await sleep(WINDOW_MS + 200)

    await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', cookie)
      .send(createWorkPayload())
      .expect(201)
  })

  it(`${String(LIMIT + 1)}-й запит POST /works/:id/editions у вікні — 429`, async () => {
    await sleep(WINDOW_MS + 200)

    // Створення Work і Edition рахуються окремими throttler-бакетами (ключ
    // включає ім'я хендлера), тож один Work тут не витрачає ліміт editions.
    const work = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', cookie)
      .send(createWorkPayload())
      .expect(201)

    const workId = (work.body as { work: { id: string } }).work.id

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .post(url(`/works/${workId}/editions`))
        .set('Cookie', cookie)
        .send({ publisher: `Видавництво ${String(attempt)}` })
        .expect(201)
    }

    const blocked = await request(app.getHttpServer())
      .post(url(`/works/${workId}/editions`))
      .set('Cookie', cookie)
      .send({ publisher: 'Останнє' })
      .expect(429)

    expect(apiErrorSchema.parse(blocked.body).code).toBe(API_ERROR_CODES.TOO_MANY_REQUESTS)
  })
})
