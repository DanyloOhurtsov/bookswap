import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  visibleLibraryResponseSchema,
  wishlistItemResponseSchema,
  wishlistResponseSchema,
} from '@bookswap/shared'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'

/**
 * §6.5 і §8, підетап 7e.
 *
 * ВАЖЛИВО про ізоляцію: e2e-файли ділять одну тестову базу й нічого не чистять
 * між тестами (див. `friends.e2e-spec.ts`). Кожна перевірка звужена за id.
 */
describe('Вішлист (e2e)', () => {
  let app: INestApplication<App>

  beforeAll(async () => {
    app = await createTestApp()
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

  async function register(prefix: string): Promise<Account> {
    sequence += 1

    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({
        email: uniqueEmail('wishlist'),
        password: VALID_PASSWORD,
        displayName: `${prefix} №${String(sequence)}-${String(process.pid)}`,
      })
      .expect(201)

    return {
      id: (response.body as { user: { id: string } }).user.id,
      cookie: sessionCookie(response.headers),
    }
  }

  async function createWork(owner: Account): Promise<string> {
    sequence += 1

    const token = `твір${String(process.pid)}${String(sequence)}`

    const response = await request(app.getHttpServer())
      .post(url('/works'))
      .set('Cookie', owner.cookie)
      .send({ title: `Книжка ${token}`, origLang: 'uk', authors: [{ name: `Автор ${token}` }] })
      .expect(201)

    return (response.body as { work: { id: string } }).work.id
  }

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

  function addToWishlist(actor: Account, workId: string): request.Test {
    return request(app.getHttpServer())
      .post(url('/me/wishlist'))
      .set('Cookie', actor.cookie)
      .send({ workId })
  }

  function removeFromWishlist(actor: Account, workId: string): request.Test {
    return request(app.getHttpServer())
      .delete(url(`/me/wishlist/${workId}`))
      .set('Cookie', actor.cookie)
  }

  async function listWishlist(actor: Account) {
    const response = await request(app.getHttpServer())
      .get(url('/me/wishlist'))
      .set('Cookie', actor.cookie)
      .expect(200)

    return wishlistResponseSchema.parse(response.body)
  }

  it('додає твір у вішлист', async () => {
    const user = await register('Власник')
    const work = await createWork(user)

    const response = await addToWishlist(user, work).expect(200)
    const parsed = wishlistItemResponseSchema.parse(response.body)

    expect(parsed.item.workId).toBe(work)

    const { items } = await listWishlist(user)

    expect(items.map((item) => item.workId)).toContain(work)
  })

  it('повторне додавання ідемпотентне: не 500, а той самий пункт', async () => {
    const user = await register('Наполегливий')
    const work = await createWork(user)

    const first = await addToWishlist(user, work).expect(200)
    const second = await addToWishlist(user, work).expect(200)

    const firstItem = wishlistItemResponseSchema.parse(first.body).item
    const secondItem = wishlistItemResponseSchema.parse(second.body).item

    expect(secondItem.id).toBe(firstItem.id)

    const { items } = await listWishlist(user)

    expect(items.filter((item) => item.workId === work)).toHaveLength(1)
  })

  it('додавання неіснуючого твору — 404 з машиночитним code', async () => {
    const user = await register('Мрійник')

    const response = await addToWishlist(user, 'нема-такого-твору').expect(404)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.NOT_FOUND)
  })

  it('видаляє твір із вішлиста', async () => {
    const user = await register('Розчарований')
    const work = await createWork(user)

    await addToWishlist(user, work).expect(200)
    await removeFromWishlist(user, work).expect(204)

    const { items } = await listWishlist(user)

    expect(items.map((item) => item.workId)).not.toContain(work)
  })

  it('повторне видалення ідемпотентне — 204, а не помилка', async () => {
    const user = await register('Двічі-видаляч')
    const work = await createWork(user)

    await addToWishlist(user, work).expect(200)
    await removeFromWishlist(user, work).expect(204)
    await removeFromWishlist(user, work).expect(204)
  })

  it('§6.5: бібліотека друга несе позначку, чи твір у моєму вішлисті', async () => {
    const owner = await register('Господар')
    const friend = await register('Гість')

    await befriend(owner, friend)

    const editionResponse = await request(app.getHttpServer())
      .post(url(`/works/${await createWork(owner)}/editions`))
      .set('Cookie', owner.cookie)
      .send({ publisher: 'Видавництво' })
      .expect(201)

    const edition = editionResponse.body as { edition: { id: string; workId: string } }

    await request(app.getHttpServer())
      .post(url('/me/library'))
      .set('Cookie', owner.cookie)
      .send({ editionId: edition.edition.id, visibility: 'FRIENDS' })
      .expect(201)

    await addToWishlist(friend, edition.edition.workId).expect(200)

    const response = await request(app.getHttpServer())
      .get(url(`/users/${owner.id}/library`))
      .set('Cookie', friend.cookie)
      .expect(200)

    const library = visibleLibraryResponseSchema.parse(response.body)
    const group = library.groups.find((item) => item.work.id === edition.edition.workId)

    expect(group?.inWishlist).toBe(true)
  })

  it('§6.5: без пункту у вішлисті позначка — false', async () => {
    const owner = await register('Господиня')
    const friend = await register('Спостерігач')

    await befriend(owner, friend)

    const editionResponse = await request(app.getHttpServer())
      .post(url(`/works/${await createWork(owner)}/editions`))
      .set('Cookie', owner.cookie)
      .send({ publisher: 'Видавництво' })
      .expect(201)

    const edition = editionResponse.body as { edition: { id: string; workId: string } }

    await request(app.getHttpServer())
      .post(url('/me/library'))
      .set('Cookie', owner.cookie)
      .send({ editionId: edition.edition.id, visibility: 'FRIENDS' })
      .expect(201)

    const response = await request(app.getHttpServer())
      .get(url(`/users/${owner.id}/library`))
      .set('Cookie', friend.cookie)
      .expect(200)

    const library = visibleLibraryResponseSchema.parse(response.body)
    const group = library.groups.find((item) => item.work.id === edition.edition.workId)

    expect(group?.inWishlist).toBe(false)
  })
})
