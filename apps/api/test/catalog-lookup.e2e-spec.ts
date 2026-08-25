import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  bookLookupResponseSchema,
  type BookLookupResult,
} from '@bookswap/shared'
import { BOOK_LOOKUP_PROVIDER } from '../src/catalog/lookup/book-lookup-provider'
import {
  VALID_PASSWORD,
  createTestApp,
  sessionCookie,
  uniqueEmail,
  uniqueIsbn13,
} from './auth.helpers'
import { FakeLookupProvider } from './lookup/fake-lookup-provider'

/**
 * §6.3, крок 1 і docs/plan/stage-7.md, етап 7b.
 *
 * `FakeLookupProvider` підмінює `BOOK_LOOKUP_PROVIDER` через `overrideProvider`
 * — жодного реального HTTP до Open Library (§11).
 */
describe('GET /catalog/lookup (e2e)', () => {
  let app: INestApplication<App>
  let cookie: string
  const fake = new FakeLookupProvider()

  const ORIGINAL_TIMEOUT = process.env.CATALOG_LOOKUP_TIMEOUT_MS

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(BOOK_LOOKUP_PROVIDER).useValue(fake)
      },
    })

    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({
        email: uniqueEmail('lookup'),
        password: VALID_PASSWORD,
        displayName: 'Пошуковець',
      })
      .expect(201)

    cookie = sessionCookie(response.headers)
  })

  afterEach(() => {
    fake.clear()

    if (ORIGINAL_TIMEOUT === undefined) delete process.env.CATALOG_LOOKUP_TIMEOUT_MS
    else process.env.CATALOG_LOOKUP_TIMEOUT_MS = ORIGINAL_TIMEOUT
  })

  afterAll(async () => {
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  /**
   * Валідний ISBN-13 для перевіреного namespace цього e2e-файлу
   * (`uniqueIsbn13`, §auth.helpers.ts).
   */
  const isbn = (): string => uniqueIsbn13('catalog-lookup')

  it('без сесії — 401 з машиночитним code', async () => {
    const response = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${isbn()}`))
      .expect(401)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.UNAUTHORIZED)
  })

  it('невалідний ISBN — 400 ДО будь-якого звернення до провайдера', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/catalog/lookup?isbn=not-an-isbn'))
      .set('Cookie', cookie)
      .expect(400)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    expect(fake.calls).toHaveLength(0)
  })

  it('нормалізує повну відповідь провайдера', async () => {
    const target = isbn()
    const full: BookLookupResult = {
      title: 'Шантарам',
      authors: ['Ґреґорі Девід Робертс'],
      publishedYear: 2003,
      language: 'en',
      publisher: 'КСД',
      coverUrl: 'https://example.com/cover.jpg',
      externalId: 'OL123456M',
    }
    fake.respondWith(target, full)

    const response = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(200)

    expect(bookLookupResponseSchema.parse(response.body).result).toEqual(full)
  })

  it('нормалізує відповідь із відсутніми полями — лишається тільки title', async () => {
    const target = isbn()
    fake.respondWith(target, { title: 'Тільки назва' })

    const response = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(200)

    const { result } = bookLookupResponseSchema.parse(response.body)

    expect(result).toEqual({ title: 'Тільки назва' })
  })

  it('провайдер не знає ISBN — 404 з CATALOG_LOOKUP_NOT_FOUND', async () => {
    const target = isbn()
    fake.respondNotFound(target)

    const response = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(404)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.CATALOG_LOOKUP_NOT_FOUND)
  })

  it('помилка провайдера — окремий code, не 500', async () => {
    const target = isbn()
    fake.respondWithError(target, 'Open Library впав')

    const response = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(502)

    expect(apiErrorSchema.parse(response.body).code).toBe(
      API_ERROR_CODES.CATALOG_LOOKUP_PROVIDER_ERROR,
    )
  })

  it('таймаут провайдера — 504 з CATALOG_LOOKUP_TIMEOUT', async () => {
    process.env.CATALOG_LOOKUP_TIMEOUT_MS = '50'

    const target = isbn()
    fake.hang(target)

    const response = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(504)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.CATALOG_LOOKUP_TIMEOUT)
  })

  it('R3: повторний запит того самого ISBN у межах TTL не йде до провайдера', async () => {
    const target = isbn()
    fake.respondWith(target, { title: 'Кешований твір' })

    await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(200)

    expect(fake.calls).toEqual([target])

    const second = await request(app.getHttpServer())
      .get(url(`/catalog/lookup?isbn=${target}`))
      .set('Cookie', cookie)
      .expect(200)

    // Провайдера не викликано вдруге — виклик і далі рівно один.
    expect(fake.calls).toEqual([target])
    expect(bookLookupResponseSchema.parse(second.body).result).toEqual({ title: 'Кешований твір' })
  })
})
