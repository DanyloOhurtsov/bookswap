import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  SEARCH_CANDIDATES_LIMIT,
  apiErrorSchema,
  editionResponseSchema,
  searchCandidatesResponseSchema,
  translationResponseSchema,
  workDetailResponseSchema,
  type SearchCandidatesResponse,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { PrismaService } from '../src/prisma/prisma.service'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'
import { uniqueIsbn13 } from './helpers/unique-isbn'

/**
 * Етап 7c: бекенд-пошук кандидатів перед створенням `Work`/`Edition` (§6.3,
 * крок 2), окремо від загального `/catalog/search`.
 *
 * Та сама ізоляція, що й у `catalog.e2e-spec.ts`: e2e-файли ділять одну базу
 * й нічого не чистять між тестами, тож кожен твір несе унікальний маркер.
 */
describe('GET /catalog/search/candidates (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let cookie: string

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)

    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({
        email: uniqueEmail('search-candidates'),
        password: VALID_PASSWORD,
        displayName: 'Дедуплікатор',
      })
      .expect(201)

    cookie = sessionCookie(response.headers)
  })

  afterAll(async () => {
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  let sequence = 0

  function marker(): string {
    sequence += 1

    return `кандидат${String(process.pid)}${String(sequence)}`
  }

  /**
   * Валідний ISBN-13 для перевіреного namespace цього e2e-файлу
   * (`uniqueIsbn13`, `./helpers/unique-isbn.ts`).
   */
  const isbn = (): string => uniqueIsbn13('catalog-search-candidates')

  async function createWork(body: Record<string, unknown>): Promise<WorkDetailResponse> {
    const response = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', cookie)
      .send(body)
      .expect(201)

    return workDetailResponseSchema.parse(response.body)
  }

  async function candidates(query: string): Promise<SearchCandidatesResponse> {
    const response = await request(app.getHttpServer())
      .get(url(`/catalog/search/candidates?q=${encodeURIComponent(query)}`))
      .set('Cookie', cookie)
      .expect(200)

    return searchCandidatesResponseSchema.parse(response.body)
  }

  it('без сесії — 401 з машиночитним code', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/catalog/search/candidates?q=шантарам'))
      .expect(401)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.UNAUTHORIZED)
  })

  it('запит коротший за два символи — 400', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/catalog/search/candidates?q=ш'))
      .set('Cookie', cookie)
      .expect(400)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
  })

  it('точний збіг за ISBN — кандидат несе Edition і Translation свого твору', async () => {
    const token = marker()
    const work = await createWork({
      title: `За номером ${token}`,
      origLang: 'uk',
      authors: [{ name: `Автор ${token}` }],
    })

    const translationResponse = await request(app.getHttpServer())
      .post(url(`/works/${work.work.id}/translations`))
      .set('Cookie', cookie)
      .send({ translator: 'Перекладач', lang: 'en', sourceLang: 'uk' })
      .expect(201)

    const { translation } = translationResponseSchema.parse(translationResponse.body)
    const translationId = translation.id
    const number = isbn()

    const editionResponse = await request(app.getHttpServer())
      .post(url(`/works/${work.work.id}/editions`))
      .set('Cookie', cookie)
      .send({ translationId, publisher: 'КСД', year: 2019, isbn13: number })
      .expect(201)

    const existingEdition = editionResponseSchema.parse(editionResponse.body).edition

    const byPlain = await candidates(number)
    const byHyphens = await candidates(`${number.slice(0, 3)}-${number.slice(3)}`)

    expect(byPlain.candidates).toHaveLength(1)
    expect(byPlain.candidates[0]?.work.id).toBe(work.work.id)
    expect(byPlain.candidates[0]?.editions.map((edition) => edition.id)).toContain(
      existingEdition.id,
    )
    expect(byPlain.candidates[0]?.translations).toHaveLength(1)
    expect(byHyphens.candidates[0]?.work.id).toBe(work.work.id)
  })

  it('несхожий ISBN — порожня видача, а не помилка', async () => {
    const results = await candidates(isbn())

    expect(results.candidates).toEqual([])
  })

  it('пошук за назвою повертає Work з Edition і Translation', async () => {
    const token = marker()
    const work = await createWork({
      title: `Шантарам ${token}`,
      origLang: 'en',
      authors: [{ name: `Робертс ${token}` }],
    })

    const translationResponse = await request(app.getHttpServer())
      .post(url(`/works/${work.work.id}/translations`))
      .set('Cookie', cookie)
      .send({ translator: 'Перекладач', lang: 'uk', sourceLang: 'en' })
      .expect(201)

    const translationId = translationResponseSchema.parse(translationResponse.body).translation.id

    await request(app.getHttpServer())
      .post(url(`/works/${work.work.id}/editions`))
      .set('Cookie', cookie)
      .send({ translationId, publisher: 'КСД', year: 2019 })
      .expect(201)

    const results = await candidates(`Шантарам ${token}`)
    const found = results.candidates.find((candidate) => candidate.work.id === work.work.id)

    expect(found).toBeDefined()
    expect(found?.editions[0]?.publisher).toBe('КСД')
    expect(found?.translations).toHaveLength(1)
  })

  it('регістр і зайві пробіли не впливають на результат', async () => {
    const token = marker()
    const work = await createWork({
      title: `Café Zürich ${token}`,
      origLang: 'de',
      authors: [{ name: `Autor ${token}` }],
    })

    const results = await candidates(`   CAFE ZURICH ${token}   `)

    expect(results.candidates.map((candidate) => candidate.work.id)).toContain(work.work.id)
  })

  it('нічого не знайдено — порожня видача, а не помилка', async () => {
    const results = await candidates(`ніякогослова${String(process.pid)}зовсім`)

    expect(results.candidates).toEqual([])
  })

  it('змержений Work не потрапляє у видачу як окремий кандидат', async () => {
    const token = marker()
    const merged = await createWork({
      title: `Дублікат ${token}`,
      origLang: 'uk',
      authors: [{ name: `Автор ${token}` }],
    })
    const canonical = await createWork({
      title: `Канонічний ${token}`,
      origLang: 'uk',
      authors: [{ name: `Інший автор ${token}` }],
    })
    const number = isbn()

    await request(app.getHttpServer())
      .post(url(`/works/${merged.work.id}/editions`))
      .set('Cookie', cookie)
      .send({ isbn13: number })
      .expect(201)

    // Інваріант R4 із docs/plan/stage-7.md: сама операція merge — Етап 7g,
    // тут потрібен лише факт «твір злитий» для перевірки виключення з видачі.
    await prisma.work.update({
      where: { id: merged.work.id },
      data: { mergedIntoId: canonical.work.id },
    })

    const byTitle = await candidates(`Дублікат ${token}`)
    const byIsbn = await candidates(number)

    expect(byTitle.candidates.map((candidate) => candidate.work.id)).not.toContain(merged.work.id)
    expect(byIsbn.candidates).toEqual([])
  })

  it('не більше SEARCH_CANDIDATES_LIMIT кандидатів', async () => {
    const token = marker()

    for (let index = 0; index < 12; index += 1) {
      await createWork({
        title: `Серія кандидатів ${token} том ${String(index)}`,
        origLang: 'uk',
        authors: [{ name: `Плідний автор ${token}` }],
      })
    }

    const results = await candidates(`Серія кандидатів ${token} том`)

    expect(results.candidates.length).toBeLessThanOrEqual(SEARCH_CANDIDATES_LIMIT)
  })
})
