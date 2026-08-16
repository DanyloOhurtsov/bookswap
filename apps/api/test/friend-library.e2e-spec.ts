import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  visibleLibraryResponseSchema,
  type Visibility,
  type VisibleLibraryResponse,
} from '@bookswap/shared'
import { PrismaService } from '../src/prisma/prisma.service'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'

/**
 * §9, матриця доступу — наскрізь, від куки до відповіді.
 *
 * `access/visibility.spec.ts` уже покриває саму матрицю чистими функціями. Тут
 * перевіряється інше й не менш важливе: що ендпоінт справді крізь неї ходить і
 * що приватні поля **не віддаються з API**, а не ховаються десь у UI.
 */
describe('Бібліотека іншої людини (e2e)', () => {
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

  async function register(): Promise<Account> {
    sequence += 1

    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({
        email: uniqueEmail('shelf'),
        password: VALID_PASSWORD,
        displayName: `Сусід ${String(process.pid)}-${String(sequence)}`,
      })
      .expect(201)

    return {
      id: (response.body as { user: { id: string } }).user.id,
      cookie: sessionCookie(response.headers),
    }
  }

  /** Зустрічний запит = згода (див. стейт-машину дружби), тож двох викликів досить. */
  async function befriend(one: Account, other: Account): Promise<void> {
    await request(app.getHttpServer())
      .post(url('/friends/requests'))
      .set('Cookie', one.cookie)
      .send({ userId: other.id })
      .expect(201)
    await request(app.getHttpServer())
      .post(url('/friends/requests'))
      .set('Cookie', other.cookie)
      .send({ userId: one.id })
      .expect(201)
  }

  async function setProfile(account: Account, body: Record<string, unknown>): Promise<void> {
    await request(app.getHttpServer())
      .patch(url('/me'))
      .set('Cookie', account.cookie)
      .send(body)
      .expect(200)
  }

  async function shelfOf(owner: Account, visibility: Visibility): Promise<string> {
    sequence += 1

    const token = `полиця${String(process.pid)}${String(sequence)}`

    const workResponse = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', owner.cookie)
      .send({ title: `Книжка ${token}`, origLang: 'uk', authors: [{ name: `Автор ${token}` }] })
      .expect(201)

    const workId = (workResponse.body as { work: { id: string } }).work.id

    const editionResponse = await request(app.getHttpServer())
      .post(url(`/works/${workId}/editions`))
      .set('Cookie', owner.cookie)
      .send({ publisher: 'Видавництво' })
      .expect(201)

    const editionId = (editionResponse.body as { edition: { id: string } }).edition.id

    const copyResponse = await request(app.getHttpServer())
      .post(url('/me/library'))
      .set('Cookie', owner.cookie)
      .send({ editionId, visibility, note: 'ПРИВАТНА НОТАТКА', acquiredAt: '2026-01-15' })
      .expect(201)

    return (copyResponse.body as { copy: { id: string } }).copy.id
  }

  async function viewLibrary(viewer: Account, owner: Account): Promise<VisibleLibraryResponse> {
    const response = await request(app.getHttpServer())
      .get(url(`/users/${owner.id}/library`))
      .set('Cookie', viewer.cookie)
      .expect(200)

    return visibleLibraryResponseSchema.parse(response.body)
  }

  function copyIds(library: VisibleLibraryResponse): string[] {
    return library.groups.flatMap((group) => group.copies.map((copy) => copy.id))
  }

  describe('видимість примірника — найсуворіше з двох (§9)', () => {
    it('друг бачить PUBLIC і FRIENDS, але не PRIVATE-примірник', async () => {
      const owner = await register()
      const friend = await register()

      await befriend(owner, friend)
      await setProfile(owner, { libraryVisibility: 'FRIENDS' })

      const open = await shelfOf(owner, 'PUBLIC')
      const forFriends = await shelfOf(owner, 'FRIENDS')
      const secret = await shelfOf(owner, 'PRIVATE')

      const visible = copyIds(await viewLibrary(friend, owner))

      expect(visible).toContain(open)
      expect(visible).toContain(forFriends)
      expect(visible).not.toContain(secret)
    })

    it('PUBLIC-примірник у FRIENDS-бібліотеці лишається схованим від стороннього', async () => {
      const owner = await register()
      const stranger = await register()

      await setProfile(owner, { libraryVisibility: 'FRIENDS' })

      const open = await shelfOf(owner, 'PUBLIC')

      // Сама бібліотека для стороннього недоступна цілком — це вже §9.
      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', stranger.cookie)
        .expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FORBIDDEN)
      expect(open).toBeDefined()
    })

    it('у PUBLIC-бібліотеці сторонній бачить лише PUBLIC-примірники', async () => {
      const owner = await register()
      const stranger = await register()

      await setProfile(owner, { libraryVisibility: 'PUBLIC' })

      const open = await shelfOf(owner, 'PUBLIC')
      const forFriends = await shelfOf(owner, 'FRIENDS')
      const secret = await shelfOf(owner, 'PRIVATE')

      const visible = copyIds(await viewLibrary(stranger, owner))

      expect(visible).toEqual([open])
      expect(visible).not.toContain(forFriends)
      expect(visible).not.toContain(secret)
    })

    it('PRIVATE-бібліотека закрита навіть для друга', async () => {
      const owner = await register()
      const friend = await register()

      await befriend(owner, friend)
      await setProfile(owner, { libraryVisibility: 'PRIVATE' })
      await shelfOf(owner, 'PUBLIC')

      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', friend.cookie)
        .expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FORBIDDEN)
    })

    it('заблокований не бачить навіть PUBLIC-бібліотеки (§6.2)', async () => {
      const owner = await register()
      const blockedUser = await register()

      await befriend(owner, blockedUser)
      await setProfile(owner, { libraryVisibility: 'PUBLIC' })
      await shelfOf(owner, 'PUBLIC')

      await request(app.getHttpServer())
        .post(url(`/friends/${blockedUser.id}/block`))
        .set('Cookie', owner.cookie)
        .expect(204)

      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', blockedUser.cookie)
        .expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
    })

    it('власник бачить власну бібліотеку крізь цей же маршрут, включно з PRIVATE', async () => {
      const owner = await register()

      await setProfile(owner, { libraryVisibility: 'PRIVATE' })

      const secret = await shelfOf(owner, 'PRIVATE')

      expect(copyIds(await viewLibrary(owner, owner))).toContain(secret)
    })

    it('неіснуючий користувач — 404', async () => {
      const viewer = await register()

      await request(app.getHttpServer())
        .get(url('/users/такого-немає/library'))
        .set('Cookie', viewer.cookie)
        .expect(404)
    })
  })

  describe('приватні поля не віддаються з API', () => {
    it('у відповіді немає ні нотатки, ні дати придбання, ні видимості примірника', async () => {
      const owner = await register()
      const friend = await register()

      await befriend(owner, friend)
      await setProfile(owner, { libraryVisibility: 'FRIENDS' })
      await shelfOf(owner, 'FRIENDS')

      const response = await request(app.getHttpServer())
        .get(url(`/users/${owner.id}/library`))
        .set('Cookie', friend.cookie)
        .expect(200)

      const raw = JSON.stringify(response.body)

      // Перевірка по сирому тілу, а не по розібраній схемі: zod зрізає зайве й
      // приховав би витік саме там, де його треба побачити.
      expect(raw).not.toContain('ПРИВАТНА НОТАТКА')
      expect(raw).not.toContain('note')
      expect(raw).not.toContain('acquiredAt')
      expect(raw).not.toContain('visibility')
      expect(raw).not.toContain('ownerId')
    })

    it('лічильники не розкривають прихованих примірників', async () => {
      const owner = await register()
      const friend = await register()

      await befriend(owner, friend)
      await setProfile(owner, { libraryVisibility: 'FRIENDS' })

      const visibleCopy = await shelfOf(owner, 'FRIENDS')
      const edition = await prisma.copy.findUniqueOrThrow({
        where: { id: visibleCopy },
        select: { editionId: true },
      })

      // Другий примірник ТОГО САМОГО видання, але прихований.
      await request(app.getHttpServer())
        .post(url('/me/library'))
        .set('Cookie', owner.cookie)
        .send({ editionId: edition.editionId, visibility: 'PRIVATE' })
        .expect(201)

      const group = (await viewLibrary(friend, owner)).groups.find(
        (item) => item.edition.id === edition.editionId,
      )

      // «×1», а не «×2»: інакше число саме по собі казало б, що є ще одна книжка.
      expect(group?.counts).toEqual({ total: 1, home: 1, out: 0 })
      expect(group?.copies).toHaveLength(1)
    })
  })

  describe('імена тримачів (§6.6)', () => {
    it('з showHolderNames = false друг бачить статус, але не імʼя', async () => {
      const owner = await register()
      const friend = await register()
      const holder = await register()

      await befriend(owner, friend)
      await setProfile(owner, { libraryVisibility: 'FRIENDS', showHolderNames: false })

      const copyId = await shelfOf(owner, 'FRIENDS')

      await prisma.copy.update({
        where: { id: copyId },
        data: { currentHolderId: holder.id, status: 'LENT_OUT' },
      })

      const hidden = (await viewLibrary(friend, owner)).groups
        .flatMap((group) => group.copies)
        .find((copy) => copy.id === copyId)

      expect(hidden?.holder).toBeNull()
      // Статус лишається: «книжки зараз немає вдома» — не приватна інформація.
      expect(hidden?.isHome).toBe(false)
      expect(hidden?.status).toBe('LENT_OUT')

      await setProfile(owner, { showHolderNames: true })

      const shown = (await viewLibrary(friend, owner)).groups
        .flatMap((group) => group.copies)
        .find((copy) => copy.id === copyId)

      expect(shown?.holder?.id).toBe(holder.id)
    })
  })
})
