import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import { API_ERROR_CODES, API_PREFIX, apiErrorSchema } from '@bookswap/shared'
import { BOOK_LOOKUP_PROVIDER } from '../src/catalog/lookup/book-lookup-provider'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'
import { FakeLookupProvider } from './lookup/fake-lookup-provider'

/**
 * §11, R2, docs/plan/stage-7.md 7b: rate limiting на `GET /catalog/lookup` —
 * окремий бакет 'lookup', не 'auth'. Ліміт і вікно тут навмисно малі — обидва
 * читаються лінькво (`common/rate-limit.config.ts`), тож підміна перед
 * підйомом застосунку діє так само, як `.env` у production (той самий
 * прийом, що й у `catalog-rate-limit.e2e-spec.ts`).
 */
describe('Rate limiting на GET /catalog/lookup (e2e)', () => {
  let app: INestApplication<App>
  let cookie: string
  const fake = new FakeLookupProvider()

  const LIMIT = 3
  const WINDOW_MS = 3000

  beforeAll(async () => {
    process.env.CATALOG_LOOKUP_RATE_LIMIT = String(LIMIT)
    process.env.CATALOG_LOOKUP_RATE_WINDOW_MS = String(WINDOW_MS)

    app = await createTestApp({
      withRateLimit: true,
      configure: (builder) => {
        builder.overrideProvider(BOOK_LOOKUP_PROVIDER).useValue(fake)
      },
    })

    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({
        email: uniqueEmail('lookup-rate-limit'),
        password: VALID_PASSWORD,
        displayName: 'Лімітник пошуку',
      })
      .expect(201)

    cookie = sessionCookie(response.headers)
  })

  afterEach(() => {
    fake.clear()
  })

  afterAll(async () => {
    delete process.env.CATALOG_LOOKUP_RATE_LIMIT
    delete process.env.CATALOG_LOOKUP_RATE_WINDOW_MS
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  let sequence = 0

  /** Валідний ISBN-13 із контрольною сумою — свій на кожен виклик. */
  function isbn(): string {
    sequence += 1

    const body = `978${String((process.pid % 100_000) * 100 + sequence).padStart(9, '0')}`
    let sum = 0

    for (const [index, character] of [...body].entries()) {
      sum += Number(character) * (index % 2 === 0 ? 1 : 3)
    }

    return `${body}${String((10 - (sum % 10)) % 10)}`
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  function lookup(target: string): request.Test {
    return request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
  }

  it(`${String(LIMIT + 1)}-й запит у вікні — 429, після вікна знову проходить`, async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      const target = isbn()
      fake.respondWith(target, { title: `Твір ${String(attempt)}` })

      await lookup(target).expect(200)
    }

    const overLimit = isbn()
    fake.respondWith(overLimit, { title: 'Понад ліміт' })

    const blocked = await lookup(overLimit).expect(429)

    expect(apiErrorSchema.parse(blocked.body).code).toBe(API_ERROR_CODES.TOO_MANY_REQUESTS)

    await sleep(WINDOW_MS + 200)

    const afterWindow = isbn()
    fake.respondWith(afterWindow, { title: 'Після вікна' })

    await lookup(afterWindow).expect(200)
  })

  it('попадання в кеш рахується лімітом так само, як cache miss', async () => {
    await sleep(WINDOW_MS + 200)

    const cached = isbn()
    fake.respondWith(cached, { title: 'Кешований твір' })

    // 1: cache miss — реальний виклик провайдера, кладе відповідь у кеш.
    await lookup(cached).expect(200)
    expect(fake.calls).toEqual([cached])

    // 2: та сама ISBN — попадання в кеш, провайдер вдруге НЕ викликається,
    // але бюджет ліміту витрачається так само.
    await lookup(cached).expect(200)
    expect(fake.calls).toEqual([cached])

    // 3-й запит (будь-який ISBN) — третя одиниця ліміту LIMIT=3.
    const third = isbn()
    fake.respondWith(third, { title: 'Третій' })
    await lookup(third).expect(200)

    // 4-й запит — ліміт вичерпано саме через кеш-хіт на кроці 2, а не лише
    // через два реальні виклики.
    const fourth = isbn()
    fake.respondWith(fourth, { title: 'Четвертий' })

    const blocked = await lookup(fourth).expect(429)

    expect(apiErrorSchema.parse(blocked.body).code).toBe(API_ERROR_CODES.TOO_MANY_REQUESTS)
  })
})
