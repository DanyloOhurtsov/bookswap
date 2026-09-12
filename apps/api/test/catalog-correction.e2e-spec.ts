import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { INestApplication, INestApplicationContext } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  editionPatchResponseSchema,
  translationPatchResponseSchema,
  workDetailResponseSchema,
  workPatchResponseSchema,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { MergeCliModule } from '../src/cli/merge-cli.module'
import { MergeService } from '../src/catalog/merge/merge.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'
import { uniqueIsbn13 } from './helpers/unique-isbn'

/**
 * Stage 8e-2 (docs/plan/stage-8-inventory.md, R8/R9/R10/R10a): `PATCH
 * /works/:id`, `/translations/:id`, `/editions/:id` — permissions, optimistic
 * concurrency + audit, author replacement.
 *
 * Same isolation caveat as `catalog.e2e-spec.ts`: shared DB, no cleanup
 * between tests — every scenario builds its own marker-tagged chain instead
 * of relying on a shared one.
 */
describe('Correction каталогу — PATCH /works|translations|editions/:id (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  const url = (path: string): string => `${API_PREFIX}${path}`

  interface Account {
    id: string
    cookie: string
  }

  let sequence = 0

  function marker(): string {
    sequence += 1

    return `correction${String(process.pid)}${String(sequence)}`
  }

  const isbn = (): string => uniqueIsbn13('correction')

  async function register(): Promise<Account> {
    const email = uniqueEmail('correction')
    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email, password: VALID_PASSWORD, displayName: `Редактор ${marker()}` })
      .expect(201)

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

    return { id: user.id, cookie: sessionCookie(response.headers) }
  }

  async function createWork(
    account: Account,
    body: Record<string, unknown>,
  ): Promise<WorkDetailResponse> {
    const response = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', account.cookie)
      .send(body)
      .expect(201)

    return workDetailResponseSchema.parse(response.body)
  }

  async function createTranslation(
    account: Account,
    workId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(url(`/works/${workId}/translations`))
      .set('Cookie', account.cookie)
      .send(body)
      .expect(201)

    return (response.body as { translation: { id: string } }).translation.id
  }

  async function createEdition(
    account: Account,
    workId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(url(`/works/${workId}/editions`))
      .set('Cookie', account.cookie)
      .send(body)
      .expect(201)

    return (response.body as { edition: { id: string } }).edition.id
  }

  async function addCopy(account: Account, editionId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(url('/me/library'))
      .set('Cookie', account.cookie)
      .send({ editionId })
      .expect(201)
  }

  async function getWork(account: Account, workId: string): Promise<WorkDetailResponse> {
    const response = await request(app.getHttpServer())
      .get(url(`/works/${workId}`))
      .set('Cookie', account.cookie)
      .expect(200)

    return workDetailResponseSchema.parse(response.body)
  }

  interface Chain {
    workId: string
    translationId: string
    editionId: string
    authorId: string
  }

  /** Work (один автор) → Translation → Edition, усе під `account` (§3 ланцюг). */
  async function createChain(account: Account, token: string): Promise<Chain> {
    const work = await createWork(account, {
      title: `Твір ${token}`,
      origLang: 'en',
      authors: [{ name: `Автор ${token}` }],
    })

    const translationId = await createTranslation(account, work.work.id, {
      translator: `Перекладач ${token}`,
      lang: 'uk',
      sourceLang: 'en',
    })

    const editionId = await createEdition(account, work.work.id, {
      translationId,
      publisher: `Видавництво ${token}`,
      isbn13: isbn(),
    })

    const authorId = work.authors[0]?.id

    if (authorId === undefined) throw new Error('Недосяжно: щойно створений Work без автора')

    return { workId: work.work.id, translationId, editionId, authorId }
  }

  function patchWork(account: Account, workId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(url(`/works/${workId}`))
      .set('Cookie', account.cookie)
      .send(body)
  }

  function patchTranslation(
    account: Account,
    translationId: string,
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .patch(url(`/translations/${translationId}`))
      .set('Cookie', account.cookie)
      .send(body)
  }

  function patchEdition(account: Account, editionId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(url(`/editions/${editionId}`))
      .set('Cookie', account.cookie)
      .send(body)
  }

  /**
   * Controlled synchronization for the concurrency tests below — deliberately
   * NOT `Promise.all` plus hope, and NOT an arbitrary sleep as the actual
   * ordering mechanism. A deferred lets this test hold a real Postgres
   * transaction open (via `await release.promise` inside `$transaction`)
   * across an `await`, so a concurrent statement that needs the same row lock
   * is FORCED to queue — a hard synchronization primitive, not a race.
   */
  function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })

    return { promise, resolve }
  }

  /**
   * Bounded hang-guard ONLY — never the proof of ordering, just a ceiling so a
   * genuinely broken scenario fails the test run instead of hanging it. The
   * actual proof of ordering lives in `waitForBlockedBy` below.
   */
  async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message))
      }, ms)
    })

    try {
      return await Promise.race([promise, timeout])
    } finally {
      clearTimeout(timer!)
    }
  }

  /**
   * Deterministic proof that some backend is genuinely queued behind
   * `blockerPid`'s still-open transaction — read directly from PostgreSQL's
   * own lock manager via `pg_blocking_pids()`, not inferred from "the HTTP
   * request hasn't resolved yet" (an unrelated delay, GC pause, or slow event
   * loop tick could equally explain that, and would explain it identically
   * whether or not the row is actually locked). `timeoutMs` is a hang-guard
   * for a genuinely broken scenario, not the mechanism that proves
   * ordering — the proof is the `pg_blocking_pids()` result itself; the poll
   * interval only paces how often we ask.
   */
  async function waitForBlockedBy(blockerPid: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      const rows = await prisma.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
      `

      if (rows.length > 0) return

      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for a backend blocked by pid ${String(blockerPid)}`)
      }

      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  describe('R8: creator/owner/stranger', () => {
    // Редагування Work.title — обов'язковий сценарій (сама назва Work).
    it('creator може PATCH Work.title', async () => {
      const token = marker()
      const creator = await register()
      const chain = await createChain(creator, token)

      const response = await patchWork(creator, chain.workId, {
        title: `Нова назва ${token}`,
        expectedRevision: 1,
      }).expect(200)
      const parsed = workPatchResponseSchema.parse(response.body)

      expect(parsed.work.title).toBe(`Нова назва ${token}`)
      expect(parsed.work.revision).toBe(2)
    })

    it('owner (володіє Copy видання твору, але не creator) може PATCH Work', async () => {
      const token = marker()
      const creator = await register()
      const owner = await register()
      const chain = await createChain(creator, token)

      await addCopy(owner, chain.editionId)

      const response = await patchWork(owner, chain.workId, {
        title: `Від власника ${token}`,
        expectedRevision: 1,
      }).expect(200)

      expect(workPatchResponseSchema.parse(response.body).work.title).toBe(`Від власника ${token}`)
    })

    it('stranger (ні creator, ні owner) отримує 403 CATALOG_EDIT_FORBIDDEN — дані не змінюються', async () => {
      const token = marker()
      const creator = await register()
      const stranger = await register()
      const chain = await createChain(creator, token)

      const response = await patchWork(stranger, chain.workId, {
        title: `Чужа спроба ${token}`,
        expectedRevision: 1,
      }).expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.CATALOG_EDIT_FORBIDDEN)

      const fresh = await getWork(creator, chain.workId)

      expect(fresh.work.title).toBe(`Твір ${token}`)
      expect(fresh.work.revision).toBe(1)
    })

    it('Translation: creator редагує, stranger отримує 403', async () => {
      const token = marker()
      const creator = await register()
      const stranger = await register()
      const chain = await createChain(creator, token)

      await patchTranslation(stranger, chain.translationId, {
        translator: 'Чужий перекладач',
        expectedRevision: 1,
      }).expect(403)

      const ok = await patchTranslation(creator, chain.translationId, {
        translator: `Новий перекладач ${token}`,
        expectedRevision: 1,
      }).expect(200)
      const parsed = translationPatchResponseSchema.parse(ok.body)

      expect(parsed.translation.translator).toBe(`Новий перекладач ${token}`)
      expect(parsed.translation.revision).toBe(2)
    })

    it('Edition: owner (Copy) редагує, stranger отримує 403', async () => {
      const token = marker()
      const creator = await register()
      const owner = await register()
      const stranger = await register()
      const chain = await createChain(creator, token)

      await addCopy(owner, chain.editionId)

      await patchEdition(stranger, chain.editionId, {
        publisher: 'Чуже видавництво',
        expectedRevision: 1,
      }).expect(403)

      const ok = await patchEdition(owner, chain.editionId, {
        publisher: `Нове видавництво ${token}`,
        expectedRevision: 1,
      }).expect(200)

      expect(editionPatchResponseSchema.parse(ok.body).edition.publisher).toBe(
        `Нове видавництво ${token}`,
      )
    })
  })

  describe('R9: revision + audit (CatalogRevision before/after)', () => {
    it('успішний PATCH title: revision зростає, аудит несе повний before/after', async () => {
      const token = marker()
      const creator = await register()
      const chain = await createChain(creator, token)

      await patchWork(creator, chain.workId, {
        title: `Оновлена назва ${token}`,
        expectedRevision: 1,
      }).expect(200)

      const revision = await prisma.catalogRevision.findFirstOrThrow({
        where: { entityType: 'WORK', entityId: chain.workId },
        orderBy: { createdAt: 'desc' },
      })

      expect(revision.actorId).toBe(creator.id)
      expect(revision.fromRevision).toBe(1)
      expect(revision.toRevision).toBe(2)
      expect((revision.before as { title: string }).title).toBe(`Твір ${token}`)
      expect((revision.after as { title: string }).title).toBe(`Оновлена назва ${token}`)
    })

    it('конкурентні PATCH з однаковою expectedRevision: рівно один 200, інший 409 CATALOG_REVISION_CONFLICT', async () => {
      const token = marker()
      const creator = await register()
      const chain = await createChain(creator, token)

      const [first, second] = await Promise.all([
        patchWork(creator, chain.workId, { title: `Варіант A ${token}`, expectedRevision: 1 }),
        patchWork(creator, chain.workId, { title: `Варіант B ${token}`, expectedRevision: 1 }),
      ])

      const statuses = [first.status, second.status].sort()

      expect(statuses).toEqual([200, 409])

      const conflict = first.status === 409 ? first : second

      expect(apiErrorSchema.parse(conflict.body).code).toBe(
        API_ERROR_CODES.CATALOG_REVISION_CONFLICT,
      )

      const fresh = await getWork(creator, chain.workId)

      // Точно один переможець: revision зросла рівно на 1, а не на 2.
      expect(fresh.work.revision).toBe(2)
      expect([`Варіант A ${token}`, `Варіант B ${token}`]).toContain(fresh.work.title)
    })

    it('rollback: неіснуючий authorId у тому самому PATCH відкочує і title, і revision, і аудит', async () => {
      const token = marker()
      const creator = await register()
      const chain = await createChain(creator, token)

      const response = await patchWork(creator, chain.workId, {
        title: `Мала б не застосуватись ${token}`,
        authors: [{ authorId: 'неіснуючий-автор' }],
        expectedRevision: 1,
      }).expect(404)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.NOT_FOUND)

      const fresh = await getWork(creator, chain.workId)

      expect(fresh.work.title).toBe(`Твір ${token}`)
      expect(fresh.work.revision).toBe(1)

      const revisionsCount = await prisma.catalogRevision.count({
        where: { entityType: 'WORK', entityId: chain.workId },
      })

      expect(revisionsCount).toBe(0)
    })
  })

  describe('Чинні правила каталогу зберігаються', () => {
    it('unique ISBN: PATCH isbn13 на зайняте значення — 409 EDITION_ISBN_TAKEN, дані не змінюються', async () => {
      const token = marker()
      const creator = await register()
      const chainA = await createChain(creator, `${token}a`)
      const chainB = await createChain(creator, `${token}b`)

      const takenIsbn = await prisma.edition
        .findUniqueOrThrow({ where: { id: chainA.editionId }, select: { isbn13: true } })
        .then((edition) => edition.isbn13)

      const response = await patchEdition(creator, chainB.editionId, {
        isbn13: takenIsbn,
        expectedRevision: 1,
      }).expect(409)

      const error = apiErrorSchema.parse(response.body)

      expect(error.code).toBe(API_ERROR_CODES.EDITION_ISBN_TAKEN)
      expect(error.details).toEqual({ editionId: chainA.editionId })

      const untouched = await prisma.edition.findUniqueOrThrow({
        where: { id: chainB.editionId },
        select: { isbn13: true, revision: true },
      })

      expect(untouched.isbn13).not.toBe(takenIsbn)
      expect(untouched.revision).toBe(1)
    })

    it('Translation має належати тому самому Work — PATCH editionів translationId на чужий переклад 400', async () => {
      const token = marker()
      const creator = await register()
      const chainA = await createChain(creator, `${token}a`)
      const chainB = await createChain(creator, `${token}b`)

      const response = await patchEdition(creator, chainA.editionId, {
        translationId: chainB.translationId,
        expectedRevision: 1,
      }).expect(400)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    })

    it('merged Work: PATCH джерела після мержу — 409 WORK_MERGED із canonicalWorkId цілі', async () => {
      const token = marker()
      const creator = await register()
      const source = await createChain(creator, `${token}source`)
      const target = await createChain(creator, `${token}target`)

      const mergeContext: INestApplicationContext = await Test.createTestingModule({
        imports: [MergeCliModule],
      }).compile()

      try {
        const merge = mergeContext.get(MergeService)

        await merge.merge(source.workId, target.workId)
      } finally {
        await mergeContext.close()
      }

      const response = await patchWork(creator, source.workId, {
        title: 'Не повинно застосуватись',
        expectedRevision: 1,
      }).expect(409)

      const error = apiErrorSchema.parse(response.body)

      expect(error.code).toBe(API_ERROR_CODES.WORK_MERGED)
      expect(error.details).toMatchObject({ canonicalWorkId: target.workId })
    })
  })

  describe('R10a: заміна й порядок авторів', () => {
    it('PATCH authors — повна заміна за порядком масиву, Author rows не видаляються', async () => {
      const token = marker()
      const creator = await register()
      const work = await createWork(creator, {
        title: `Порядок ${token}`,
        origLang: 'uk',
        authors: [{ name: `Перший ${token}` }, { name: `Другий ${token}` }],
      })

      const firstId = work.authors[0]?.id
      const secondId = work.authors[1]?.id

      if (firstId === undefined || secondId === undefined) {
        throw new Error('Недосяжно: щойно створений Work без двох авторів')
      }

      const response = await patchWork(creator, work.work.id, {
        authors: [{ authorId: secondId }, { authorId: firstId }, { name: `Третій ${token}` }],
        expectedRevision: 1,
      }).expect(200)

      const authors = (response.body as { authors: { id: string; position: number }[] }).authors

      expect(authors.map((author) => author.id).slice(0, 2)).toEqual([secondId, firstId])
      expect(authors.map((author) => author.position)).toEqual([0, 1, 2])

      // Author rows самі лишаються в базі — заміна лише WorkAuthor-звʼязків.
      const stillThere = await prisma.author.count({ where: { id: { in: [firstId, secondId] } } })

      expect(stillThere).toBe(2)
    })

    it('не дедуплікує авторів за іменем — тезка отримує новий Author', async () => {
      const token = marker()
      const creator = await register()
      const name = `Тезка ${token}`
      const work = await createWork(creator, {
        title: `Твір з тезкою ${token}`,
        origLang: 'uk',
        authors: [{ name }],
      })

      const response = await patchWork(creator, work.work.id, {
        authors: [{ name }],
        expectedRevision: 1,
      }).expect(200)

      const newAuthorId = (response.body as { authors: { id: string }[] }).authors[0]?.id

      expect(newAuthorId).not.toBe(work.authors[0]?.id)
    })

    it('authorId + nameLatin разом — 400, навіть nameLatin: null, і Work не змінюється (PO-рішення R10a)', async () => {
      const token = marker()
      const creator = await register()
      const chain = await createChain(creator, token)

      const withString = await patchWork(creator, chain.workId, {
        authors: [{ authorId: chain.authorId, nameLatin: 'Something' }],
        expectedRevision: 1,
      }).expect(400)

      expect(apiErrorSchema.parse(withString.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)

      const withNull = await patchWork(creator, chain.workId, {
        authors: [{ authorId: chain.authorId, nameLatin: null }],
        expectedRevision: 1,
      }).expect(400)

      expect(apiErrorSchema.parse(withNull.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)

      const fresh = await getWork(creator, chain.workId)

      expect(fresh.work.revision).toBe(1)
    })
  })

  describe('Конкурентність PATCH проти MergeService (детермінована синхронізація)', () => {
    /**
     * Reproduces the exact race named in the fix request: a merge finishes in
     * the window between `PATCH /works/:id`'s initial read and its write.
     *
     * `MergeService.merge()` cannot be paused mid-transaction without
     * changing its source (out of scope here), so this hand-rolls the ONE
     * statement that actually matters for the race — the same `FOR UPDATE`
     * `lockWorks` takes, then setting `mergedIntoId` WITHOUT bumping
     * `revision`, exactly like the real merge — and holds it open via
     * `release`. That is enough to prove both the bug (pre-fix: `patchWork`
     * only checked `mergedIntoId` before ever opening its transaction, and
     * its `UPDATE ... WHERE revision = $N` could not see the merge either,
     * since `revision` never moves) and the fix (post-fix: `patchWork` takes
     * the SAME lock first, so it queues here and re-reads `mergedIntoId`
     * AFTER the merge commits).
     */
    it('merge завершується між читанням і записом PATCH — Work не отримує запис, 409 WORK_MERGED', async () => {
      const token = marker()
      const creator = await register()
      const source = await createChain(creator, `${token}source`)
      const target = await createChain(creator, `${token}target`)

      const ready = createDeferred<void>()
      const release = createDeferred<void>()
      let mergePid: number | undefined
      let patchingCleanup: Promise<unknown> | undefined

      // Holds a real Postgres transaction open on `source`'s row: locks it,
      // performs the exact write that matters for the race (`mergedIntoId`
      // set WITHOUT bumping `revision`, same as the real merge), THEN signals
      // `ready` — so the test below never fires PATCH against a half-set-up
      // "merge" that hasn't taken its lock or made its write yet.
      const merging = prisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`

        if (backend === undefined) throw new Error('Недосяжно: pg_backend_pid() повернув 0 рядків')

        mergePid = backend.pid

        await tx.$queryRaw`SELECT "id" FROM "Work" WHERE "id" = ${source.workId} FOR UPDATE`
        await tx.work.update({
          where: { id: source.workId },
          data: { mergedIntoId: target.workId },
        })

        ready.resolve()

        await release.promise
      })

      try {
        await withTimeout(ready.promise, 5000, 'merge transaction never signaled ready')

        if (mergePid === undefined) {
          throw new Error('Недосяжно: ready resolved without capturing pg_backend_pid()')
        }

        const patching = Promise.resolve(
          patchWork(creator, source.workId, {
            title: 'Не повинно застосуватись',
            expectedRevision: 1,
          }),
        )

        patchingCleanup = patching

        // Deterministic proof of contention, read from PostgreSQL's own lock
        // manager: PATCH's backend is ACTUALLY queued behind the held
        // "merge" transaction's backend — not merely "hasn't replied yet".
        await waitForBlockedBy(mergePid)

        release.resolve()
        await merging

        const response = await patching

        expect(response.status).toBe(409)
        const error = apiErrorSchema.parse(response.body)

        expect(error.code).toBe(API_ERROR_CODES.WORK_MERGED)
        expect(error.details).toMatchObject({ canonicalWorkId: target.workId })

        const fresh = await prisma.work.findUniqueOrThrow({
          where: { id: source.workId },
          select: { title: true, revision: true },
        })

        // The write from the queued PATCH must never have landed — title and
        // revision are exactly what `createChain` left them at.
        expect(fresh.title).toBe(`Твір ${token}source`)
        expect(fresh.revision).toBe(1)

        const revisionsCount = await prisma.catalogRevision.count({
          where: { entityType: 'WORK', entityId: source.workId },
        })

        expect(revisionsCount).toBe(0)
      } finally {
        // Never leave the held transaction (or a still-queued PATCH) hanging
        // past this test, even if an assertion above threw: `resolve` on an
        // already-settled deferred is a no-op, and `.catch()` here only
        // waits the promise out — it does not swallow a real test failure,
        // since we never re-throw from a `finally` block.
        release.resolve()
        await merging.catch(() => undefined)

        if (patchingCleanup !== undefined) await patchingCleanup.catch(() => undefined)
      }
    })

    /**
     * The other half of the same fix, from the TARGET side: a merge's author
     * consolidation (`MergeService.consolidateWorkAuthors`) lands on the
     * TARGET Work — which is not merged away, so the `mergedIntoId` guard
     * above does not fire for it at all — in the window between `patchWork`'s
     * `before` read and its write. `Work.revision` does not move for this
     * either. A `before` taken from an unlocked pre-transaction read would
     * describe the target's author list as it stood BEFORE the concurrent
     * consolidation committed — an audit row that lies about the state this
     * PATCH actually edited. The fix reads `before` under the same lock the
     * consolidation's write needs, so it can only ever see the fully
     * pre-PATCH, fully post-consolidation state — never a torn one.
     */
    it('конкурентна консолідація авторів у TARGET між читанням before і записом — аудит не губить автора', async () => {
      const token = marker()
      const creator = await register()
      const source = await createChain(creator, `${token}source`)
      const target = await createWork(creator, {
        title: `Ціль ${token}`,
        origLang: 'en',
        authors: [{ name: `Автор цілі ${token}` }],
      })

      const sourceAuthor = await prisma.workAuthor.findFirstOrThrow({
        where: { workId: source.workId },
        select: { authorId: true, role: true },
      })

      const ready = createDeferred<void>()
      const release = createDeferred<void>()
      let mergePid: number | undefined
      let patchingCleanup: Promise<unknown> | undefined

      // Locks both Work rows (the same ordered `FOR UPDATE` `lockWorks`
      // takes), appends the source's author link onto the target — WITHOUT
      // bumping the target's own `revision`, same as the real
      // `consolidateWorkAuthors` — THEN signals `ready`.
      const merging = prisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`

        if (backend === undefined) throw new Error('Недосяжно: pg_backend_pid() повернув 0 рядків')

        mergePid = backend.pid

        await tx.$queryRaw`
          SELECT "id" FROM "Work" WHERE "id" IN (${source.workId}, ${target.work.id})
          ORDER BY "id" FOR UPDATE
        `
        await tx.workAuthor.create({
          data: {
            workId: target.work.id,
            authorId: sourceAuthor.authorId,
            role: sourceAuthor.role,
            position: 1,
          },
        })

        ready.resolve()

        await release.promise
      })

      try {
        await withTimeout(ready.promise, 5000, 'merge transaction never signaled ready')

        if (mergePid === undefined) {
          throw new Error('Недосяжно: ready resolved without capturing pg_backend_pid()')
        }

        const patching = Promise.resolve(
          patchWork(creator, target.work.id, {
            title: `Оновлена ціль ${token}`,
            expectedRevision: 1,
          }),
        )

        patchingCleanup = patching

        // Same PostgreSQL-verified proof of contention as the source-side test.
        await waitForBlockedBy(mergePid)

        release.resolve()
        await merging

        const response = await patching

        expect(response.status).toBe(200)

        const revision = await prisma.catalogRevision.findFirstOrThrow({
          where: { entityType: 'WORK', entityId: target.work.id },
          orderBy: { createdAt: 'desc' },
        })

        const beforeAuthors = (revision.before as { authors: { authorId: string }[] }).authors

        // Bug (pre-fix): a stale `before`, read before this transaction even
        // opened, would show only the target's original author — the
        // concurrently-added one is invisible to it. Fix: `before` is read
        // AFTER the lock, so it correctly includes both.
        expect(beforeAuthors.map((author) => author.authorId)).toContain(sourceAuthor.authorId)
        expect(beforeAuthors).toHaveLength(2)
      } finally {
        release.resolve()
        await merging.catch(() => undefined)

        if (patchingCleanup !== undefined) await patchingCleanup.catch(() => undefined)
      }
    })
  })

  describe('R8: додаткові шляхи власності', () => {
    it('owner (Copy відповідного Edition) може PATCH Translation, на яку той Edition посилається', async () => {
      const token = marker()
      const creator = await register()
      const owner = await register()
      const chain = await createChain(creator, token)

      await addCopy(owner, chain.editionId)

      const response = await patchTranslation(owner, chain.translationId, {
        translator: `Через Copy Edition ${token}`,
        expectedRevision: 1,
      }).expect(200)

      expect(translationPatchResponseSchema.parse(response.body).translation.translator).toBe(
        `Через Copy Edition ${token}`,
      )
    })

    it('creator (без власного Copy) може PATCH Edition', async () => {
      const token = marker()
      const creator = await register()
      // `createChain` never calls `addCopy` — the creator owns no Copy here.
      const chain = await createChain(creator, token)

      const response = await patchEdition(creator, chain.editionId, {
        publisher: `Творцем без Copy ${token}`,
        expectedRevision: 1,
      }).expect(200)

      expect(editionPatchResponseSchema.parse(response.body).edition.publisher).toBe(
        `Творцем без Copy ${token}`,
      )
    })
  })

  describe('доступ без сесії', () => {
    it.each([
      ['patch', '/works/whatever'],
      ['patch', '/translations/whatever'],
      ['patch', '/editions/whatever'],
    ] as const)('%s %s без кукі — 401 з машиночитним code', async (method, path) => {
      const response = await request(app.getHttpServer())[method](url(path)).send({}).expect(401)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.UNAUTHORIZED)
    })
  })
})
