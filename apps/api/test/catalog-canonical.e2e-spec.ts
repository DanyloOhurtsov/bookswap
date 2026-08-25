import 'reflect-metadata'
import request from 'supertest'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  catalogSearchResponseSchema,
  editionResponseSchema,
  libraryResponseSchema,
  translationListResponseSchema,
  translationResponseSchema,
  workDetailResponseSchema,
  workHistoryResponseSchema,
  workMergedDetailsSchema,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { MergeService } from '../src/catalog/merge/merge.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { WORK_MERGE_ERROR_CODES } from '../src/catalog/merge/merge-errors'
import {
  VALID_PASSWORD,
  createTestApp,
  sessionCookie,
  uniqueEmail,
  uniqueIsbn13,
} from './auth.helpers'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * §6.3 «Читання за id зі встановленим `mergedIntoId` віддає 301 на канонічний»,
 * підетап 7h.
 *
 * Мержі робить справжній `MergeService`. Ставити `mergedIntoId` руками тут не
 * можна: половина перевірок нижче про те, що читання бачить саме той стан, який
 * лишає по собі 7g (перенесені видання, переклади й вішлист, перенаправлені
 * вхідні мержі).
 *
 * Сервіс будується на `PrismaService` самого застосунку, а не піднімається
 * окремим контекстом `MergeCliModule`: другий контекст означав би другий пул
 * підключень до тієї самої бази на весь файл. Що адмінська команда взагалі
 * збирається, перевіряє `catalog-merge.e2e-spec.ts` — тут предмет інший.
 *
 * supertest за замовчуванням не йде за редиректом (`redirects(0)`), тож 301
 * видно напряму, а перехід за `Location` — це окремий явний запит.
 *
 * ВАЖЛИВО про ізоляцію: e2e-файли ділять одну тестову базу й нічого не чистять
 * між тестами, тож кожен твір несе унікальний маркер у назві.
 */
describe('Канонічне розв’язання Work (e2e)', () => {
  let app: INestApplication<App>
  let merge: MergeService
  let prisma: PrismaService
  let cookie: string

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    merge = new MergeService(prisma)

    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({
        email: uniqueEmail('canonical'),
        password: VALID_PASSWORD,
        displayName: 'Розв’язувач',
      })
      .expect(201)

    cookie = sessionCookie(response.headers)
  })

  afterAll(async () => {
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  let sequence = 0

  /** Маркер, за яким пошук знайде саме цей запис, а не сусідній тест чи seed. */
  function marker(): string {
    sequence += 1

    return `канонікум${String(process.pid)}${String(sequence)}`
  }

  /**
   * Валідний ISBN-13 для перевіреного namespace цього e2e-файлу
   * (`uniqueIsbn13`, §auth.helpers.ts). Префікс 979 — інший Bookland-діапазон,
   * ніж у сусідніх lookup-файлів (978), суто щоб файл лишався візуально
   * впізнаваним у логах; на унікальність це не впливає, її дає namespace.
   */
  const isbn = (): string => uniqueIsbn13('catalog-canonical', '979')

  async function createWork(title: string, authorName: string): Promise<WorkDetailResponse> {
    const response = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', cookie)
      .send({ title, origLang: 'uk', authors: [{ name: authorName }] })
      .expect(201)

    return workDetailResponseSchema.parse(response.body)
  }

  /**
   * Другий твір ТОГО САМОГО автора — за id, а не за іменем.
   *
   * `POST /works` авторів за іменем не дедуплікує (`CatalogService` завжди робить
   * `author.create`), тож два виклики `createWork` з однаковим `authorName` дають
   * ДВОХ різних авторів: один прив'язаний до дубліката, другий до канонічного.
   * Для перевірки лічильника творів це не дрібниця, а зміна предмета: у видачі
   * тоді два однойменні `authorMatches`, `find()` бере довільного з них, і тест
   * зеленіє або падає залежно від порядку, у якому їх поверне пошук.
   */
  async function createWorkForAuthor(title: string, authorId: string): Promise<WorkDetailResponse> {
    const response = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', cookie)
      .send({ title, origLang: 'uk', authors: [{ authorId }] })
      .expect(201)

    return workDetailResponseSchema.parse(response.body)
  }

  async function createEdition(workId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(url(`/works/${workId}/editions`))
      .set('Cookie', cookie)
      .send({ isbn13: isbn(), publisher: 'Видавництво' })
      .expect(201)

    return editionResponseSchema.parse(response.body).edition.id
  }

  async function createTranslation(workId: string, translator: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(url(`/works/${workId}/translations`))
      .set('Cookie', cookie)
      .send({ translator, lang: 'uk', sourceLang: 'en' })
      .expect(201)

    return translationResponseSchema.parse(response.body).translation.id
  }

  /** Пара «дублікат → канонічний», уже злита справжнім мержем. */
  async function mergedPair(): Promise<{ token: string; source: string; target: string }> {
    const token = marker()
    const source = await createWork(`Дублікат ${token}`, `Автор ${token}`)
    const target = await createWork(`Канонічний ${token}`, `Автор ${token}`)

    await merge.merge(source.work.id, target.work.id)

    return { token, source: source.work.id, target: target.work.id }
  }

  /**
   * 301 несе і машиночитний код, і обидва id — див. `workMergedDetailsSchema`.
   * Повертає перевірений `Location`, щоб перехід за ним був типізованим рядком,
   * а не `string | undefined` із заголовків.
   */
  function expectRedirect(
    response: request.Response,
    { from, to, suffix = '' }: { from: string; to: string; suffix?: string },
  ): string {
    const location = `${API_PREFIX}/works/${to}${suffix}`

    expect(response.status).toBe(301)
    expect(response.headers.location).toBe(location)
    // Мерж не остаточний: `A→B`, потім `B→C` перенаправляє `A` на `C`, тож
    // вічно закешований 301 водив би людей через проміжний твір.
    expect(response.headers['cache-control']).toBe('no-store')

    const error = apiErrorSchema.parse(response.body)

    expect(error.code).toBe(API_ERROR_CODES.WORK_MERGED)
    expect(workMergedDetailsSchema.parse(error.details)).toEqual({
      canonicalWorkId: to,
      requestedWorkId: from,
    })

    return location
  }

  describe('читання за старим id', () => {
    it('GET /works/:id — 301 на канонічний, і за Location лежать його дані', async () => {
      const { token, source, target } = await mergedPair()

      const redirect = await request(app.getHttpServer())
        .get(url(`/works/${source}`))
        .set('Cookie', cookie)

      const location = expectRedirect(redirect, { from: source, to: target })

      const followed = await request(app.getHttpServer())
        .get(location)
        .set('Cookie', cookie)
        .expect(200)

      const detail = workDetailResponseSchema.parse(followed.body)

      expect(detail.work.id).toBe(target)
      expect(detail.work.title).toBe(`Канонічний ${token}`)
    })

    it('GET /works/:id/translations — 301, і переклад дубліката вже на канонічному', async () => {
      const token = marker()
      const source = await createWork(`Дублікат ${token}`, `Автор ${token}`)
      const target = await createWork(`Канонічний ${token}`, `Автор ${token}`)
      const translationId = await createTranslation(source.work.id, `Перекладач ${token}`)

      await merge.merge(source.work.id, target.work.id)

      const redirect = await request(app.getHttpServer())
        .get(url(`/works/${source.work.id}/translations`))
        .set('Cookie', cookie)

      const location = expectRedirect(redirect, {
        from: source.work.id,
        to: target.work.id,
        suffix: '/translations',
      })

      const followed = await request(app.getHttpServer())
        .get(location)
        .set('Cookie', cookie)
        .expect(200)

      const { translations } = translationListResponseSchema.parse(followed.body)

      expect(translations.map((translation) => translation.id)).toContain(translationId)
    })

    it('GET /works/:id/history — 301 на історію канонічного', async () => {
      const { source, target } = await mergedPair()

      const redirect = await request(app.getHttpServer())
        .get(url(`/works/${source}/history`))
        .set('Cookie', cookie)

      const location = expectRedirect(redirect, { from: source, to: target, suffix: '/history' })

      const followed = await request(app.getHttpServer())
        .get(location)
        .set('Cookie', cookie)
        .expect(200)

      expect(workHistoryResponseSchema.parse(followed.body).work.id).toBe(target)
    })

    it('канонічний твір читається як раніше — 200 і жодного Location', async () => {
      const token = marker()
      const work = await createWork(`Самотній ${token}`, `Автор ${token}`)

      const response = await request(app.getHttpServer())
        .get(url(`/works/${work.work.id}`))
        .set('Cookie', cookie)
        .expect(200)

      expect(response.headers.location).toBeUndefined()
      expect(workDetailResponseSchema.parse(response.body).work.id).toBe(work.work.id)
    })

    it.each(['', '/translations', '/history'])(
      'неіснуючий твір лишається 404, а не редиректом (GET /works/:id%s)',
      async (suffix) => {
        const response = await request(app.getHttpServer())
          .get(url(`/works/нема-такого-твору${suffix}`))
          .set('Cookie', cookie)
          .expect(404)

        expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.NOT_FOUND)
      },
    )
  })

  /**
   * DoD 7h: «глибина розв'язання рівно 1 — доводиться тестом, який показує, що
   * ланцюг довший за один крок неможливо створити».
   *
   * Доводиться з двох боків: мерж перенаправляє вхідні посилання на нову ціль,
   * і мерж із неканонічного або в неканонічний твір відхиляється. Тому
   * `CanonicalWorkService` обходиться одним `findUnique` без циклу.
   */
  describe('глибина розв’язання', () => {
    it('A→B, потім B→C: A вказує вже на C, і редирект веде одразу туди', async () => {
      const token = marker()
      const first = await createWork(`Перший ${token}`, `Автор ${token}`)
      const second = await createWork(`Другий ${token}`, `Автор ${token}`)
      const third = await createWork(`Третій ${token}`, `Автор ${token}`)

      await merge.merge(first.work.id, second.work.id)
      await merge.merge(second.work.id, third.work.id)

      const rows = await prisma.work.findMany({
        where: { id: { in: [first.work.id, second.work.id] } },
        select: { id: true, mergedIntoId: true },
      })

      // Ланцюга A→B→C не існує: після другого мержу обидва вказують на C.
      expect(new Map(rows.map((row) => [row.id, row.mergedIntoId]))).toEqual(
        new Map([
          [first.work.id, third.work.id],
          [second.work.id, third.work.id],
        ]),
      )

      const redirect = await request(app.getHttpServer())
        .get(url(`/works/${first.work.id}`))
        .set('Cookie', cookie)

      expectRedirect(redirect, { from: first.work.id, to: third.work.id })
    })

    it('ланцюг не створити: мерж із уже змерженого і в уже змержений — відхилено', async () => {
      const token = marker()
      const { source, target } = await mergedPair()
      const other = await createWork(`Сторонній ${token}`, `Автор ${token}`)

      await expect(merge.merge(source, other.work.id)).rejects.toMatchObject({
        code: WORK_MERGE_ERROR_CODES.WORK_MERGE_SOURCE_ALREADY_MERGED,
      })
      await expect(merge.merge(other.work.id, source)).rejects.toMatchObject({
        code: WORK_MERGE_ERROR_CODES.WORK_MERGE_TARGET_ALREADY_MERGED,
      })

      // Стан не змінився: `other` лишився канонічним, `source` — злитим у той самий твір.
      const rows = await prisma.work.findMany({
        where: { id: { in: [source, other.work.id] } },
        select: { id: true, mergedIntoId: true },
      })

      expect(new Map(rows.map((row) => [row.id, row.mergedIntoId]))).toEqual(
        new Map([
          [source, target],
          [other.work.id, null],
        ]),
      )
    })
  })

  /**
   * Запис не редиректиться: 301 на POST історично перетворює його на GET, а
   * мовчазне перенацілювання записало б дані в запис, якого клієнт не називав.
   */
  describe('запис за старим id', () => {
    function expectMergedConflict(response: request.Response, canonicalWorkId: string): void {
      expect(response.status).toBe(409)

      const error = apiErrorSchema.parse(response.body)

      expect(error.code).toBe(API_ERROR_CODES.WORK_MERGED)
      expect(workMergedDetailsSchema.parse(error.details).canonicalWorkId).toBe(canonicalWorkId)
    }

    it('POST /works/:id/translations — 409 з канонічним id', async () => {
      const { token, source, target } = await mergedPair()

      const response = await request(app.getHttpServer())
        .post(url(`/works/${source}/translations`))
        .set('Cookie', cookie)
        .send({ translator: `Перекладач ${token}`, lang: 'uk', sourceLang: 'en' })

      expectMergedConflict(response, target)
    })

    it('POST /works/:id/editions — 409 з канонічним id', async () => {
      const { source, target } = await mergedPair()

      const response = await request(app.getHttpServer())
        .post(url(`/works/${source}/editions`))
        .set('Cookie', cookie)
        .send({ isbn13: isbn(), publisher: 'Видавництво' })

      expectMergedConflict(response, target)
    })

    it('POST /me/wishlist — 409 з канонічним id', async () => {
      const { source, target } = await mergedPair()

      const response = await request(app.getHttpServer())
        .post(url('/me/wishlist'))
        .set('Cookie', cookie)
        .send({ workId: source })

      expectMergedConflict(response, target)
    })

    it('DELETE /me/wishlist/:workId — 409: рядок не зник, а переїхав', async () => {
      const token = marker()
      const source = await createWork(`Дублікат ${token}`, `Автор ${token}`)
      const target = await createWork(`Канонічний ${token}`, `Автор ${token}`)

      await request(app.getHttpServer())
        .post(url('/me/wishlist'))
        .set('Cookie', cookie)
        .send({ workId: source.work.id })
        .expect(200)

      await merge.merge(source.work.id, target.work.id)

      const response = await request(app.getHttpServer())
        .delete(url(`/me/wishlist/${source.work.id}`))
        .set('Cookie', cookie)

      expectMergedConflict(response, target.work.id)

      // Пункт нікуди не подівся — він на канонічному творі, і прибрати його
      // можна саме звідти. Мовчазний успіх на старому id лишив би його в списку.
      await request(app.getHttpServer())
        .delete(url(`/me/wishlist/${target.work.id}`))
        .set('Cookie', cookie)
        .expect(204)
    })
  })

  /**
   * §6.3, крок 2 і DoD 7h: змержений твір не є окремою позицією у видачі.
   * `/catalog/search/candidates` покритий власним файлом (`7c`), тут — загальний
   * пошук і те, що ховається за ним: лічильник творів автора.
   */
  describe('видача', () => {
    it('GET /catalog/search не показує змержений твір як окрему позицію', async () => {
      const token = marker()
      const source = await createWork(`Спільна назва ${token}`, `Автор ${token}`)
      const authorId = source.authors[0]?.id ?? ''
      // Той самий автор на обидва твори — інакше в базі їх двоє, і лічильник
      // нижче міряв би випадкового з них. Див. `createWorkForAuthor`.
      const target = await createWorkForAuthor(`Спільна назва ${token} канон`, authorId)

      await merge.merge(source.work.id, target.work.id)

      const response = await request(app.getHttpServer())
        .get(url(`/catalog/search?q=${encodeURIComponent(`Спільна назва ${token}`)}`))
        .set('Cookie', cookie)
        .expect(200)

      const { results, authorMatches } = catalogSearchResponseSchema.parse(response.body)
      const ids = results.map((result) => result.work.id)

      expect(ids).toContain(target.work.id)
      expect(ids).not.toContain(source.work.id)

      // Автор писав один твір, а не два: `WorkAuthor` мерж не переносить, тож
      // без фільтра лічильник рахував би й дублікат. Автор тут рівно один
      // (обидва твори створені на його id), і саме тому число визначене.
      const authors = authorMatches.filter((match) => match.name === `Автор ${token}`)

      expect(authors).toHaveLength(1)
      expect(authors[0]?.workCount).toBe(1)
    })

    it('пошук за ISBN веде на канонічний твір, а не на змержений', async () => {
      const token = marker()
      const source = await createWork(`Дублікат ${token}`, `Автор ${token}`)
      const target = await createWork(`Канонічний ${token}`, `Автор ${token}`)
      const number = isbn()

      await request(app.getHttpServer())
        .post(url(`/works/${source.work.id}/editions`))
        .set('Cookie', cookie)
        .send({ isbn13: number })
        .expect(201)

      await merge.merge(source.work.id, target.work.id)

      const response = await request(app.getHttpServer())
        .get(url(`/catalog/search?q=${number}`))
        .set('Cookie', cookie)
        .expect(200)

      const { results } = catalogSearchResponseSchema.parse(response.body)

      expect(results.map((result) => result.work.id)).toEqual([target.work.id])
    })
  })

  /**
   * `Edition` мерж переносить разом із рештою, тож `Edition.workId` завжди
   * канонічний — саме тому `POST /me/library` не має справи зі змерженими
   * творами й не потребує окремої перевірки. Це твердження й перевіряється:
   * примірник кладеться на видання, яке переїхало під час мержу.
   */
  it('POST /me/library за переїхалим editionId — примірник лягає під канонічний твір', async () => {
    const token = marker()
    const source = await createWork(`Дублікат ${token}`, `Автор ${token}`)
    const target = await createWork(`Канонічний ${token}`, `Автор ${token}`)
    const editionId = await createEdition(source.work.id)

    await merge.merge(source.work.id, target.work.id)

    await request(app.getHttpServer())
      .post(url('/me/library'))
      .set('Cookie', cookie)
      .send({ editionId, condition: 'GOOD', visibility: 'FRIENDS' })
      .expect(201)

    const response = await request(app.getHttpServer())
      .get(url('/me/library'))
      .set('Cookie', cookie)
      .expect(200)

    const group = libraryResponseSchema
      .parse(response.body)
      .groups.find((candidate) => candidate.edition.id === editionId)

    expect(group?.work.id).toBe(target.work.id)
    expect(group?.edition.workId).toBe(target.work.id)
  })
})
