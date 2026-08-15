import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import {
  API_ERROR_CODES,
  API_PREFIX,
  apiErrorSchema,
  friendListResponseSchema,
  friendRequestsResponseSchema,
  friendshipStateResponseSchema,
  userSearchResponseSchema,
  type FriendRelation,
} from '@bookswap/shared'
import { PrismaService } from '../src/prisma/prisma.service'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'
import { createGraph } from './db/fixtures'

/**
 * §6.2 і §8, блок «Дружба».
 *
 * ВАЖЛИВО про ізоляцію: e2e-файли ділять одну тестову базу й нічого не чистять між
 * тестами. Тому кожна перевірка стану БД мусить бути звужена за id — жодних
 * `count()` без `where`, інакше тест почне залежати від сусідів.
 */
describe('Дружба (e2e)', () => {
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
    email: string
    displayName: string
  }

  let sequence = 0

  /** Унікальне імʼя на кожен акаунт: пошук за імʼям ходить по спільній базі. */
  async function register(prefix: string): Promise<Account> {
    sequence += 1

    const email = uniqueEmail('friends')
    const displayName = `${prefix} №${String(sequence)}-${String(process.pid)}`

    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email, password: VALID_PASSWORD, displayName })
      .expect(201)

    const id = (response.body as { user: { id: string } }).user.id

    return { id, cookie: sessionCookie(response.headers), email, displayName }
  }

  async function pair(): Promise<[Account, Account]> {
    return [await register('Перший'), await register('Другий')]
  }

  function sendRequest(actor: Account, target: Account): request.Test {
    return request(app.getHttpServer())
      .post(url('/friends/requests'))
      .set('Cookie', actor.cookie)
      .send({ userId: target.id })
  }

  function respond(actor: Account, requestId: string, action: 'accept' | 'decline'): request.Test {
    return request(app.getHttpServer())
      .patch(url(`/friends/requests/${requestId}`))
      .set('Cookie', actor.cookie)
      .send({ action })
  }

  async function requestsOf(account: Account): Promise<{
    incoming: { id: string; user: { id: string } }[]
    outgoing: { id: string; user: { id: string } }[]
  }> {
    const response = await request(app.getHttpServer())
      .get(url('/friends/requests'))
      .set('Cookie', account.cookie)
      .expect(200)

    return friendRequestsResponseSchema.parse(response.body)
  }

  async function friendIdsOf(account: Account): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get(url('/friends'))
      .set('Cookie', account.cookie)
      .expect(200)

    return friendListResponseSchema.parse(response.body).friends.map((friend) => friend.user.id)
  }

  /** Рядок пари напряму з бази — для перевірок інваріантів, які API не показує. */
  async function rowOf(one: Account, other: Account) {
    const [userAId, userBId] = [one.id, other.id].sort()

    return prisma.friendship.findFirst({ where: { userAId, userBId } })
  }

  async function befriend(one: Account, other: Account): Promise<void> {
    await sendRequest(one, other).expect(201)

    const { incoming } = await requestsOf(other)
    const invitation = incoming.find((item) => item.user.id === one.id)

    if (invitation === undefined) throw new Error('Запит не дійшов до отримувача')

    await respond(other, invitation.id, 'accept').expect(200)
  }

  async function relationTo(viewer: Account, target: Account): Promise<FriendRelation | undefined> {
    const response = await request(app.getHttpServer())
      .get(url('/users'))
      .query({ email: target.email })
      .set('Cookie', viewer.cookie)
      .expect(200)

    return userSearchResponseSchema.parse(response.body).results[0]?.relation
  }

  async function notificationsFor(userId: string, type: string): Promise<{ payload: unknown }[]> {
    return prisma.notification.findMany({ where: { userId, type: type as never } })
  }

  // -------------------------------------------------------------------------

  describe('доступ без сесії', () => {
    it.each([
      ['get', '/friends'],
      ['get', '/friends/requests'],
      ['post', '/friends/requests'],
      ['patch', '/friends/requests/whatever'],
      ['delete', '/friends/someone'],
      ['post', '/friends/someone/block'],
    ] as const)('%s %s без кукі — 401 з машиночитним code', async (method, path) => {
      const response = await request(app.getHttpServer())[method](url(path)).send({}).expect(401)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.UNAUTHORIZED)
    })
  })

  describe('POST /friends/requests', () => {
    it('надсилає запит і показує його обом сторонам', async () => {
      const [marta, oles] = await pair()

      const response = await sendRequest(marta, oles).expect(201)

      expect(friendshipStateResponseSchema.parse(response.body).relation).toBe('REQUEST_SENT')

      const sender = await requestsOf(marta)
      const receiver = await requestsOf(oles)

      expect(sender.outgoing.map((item) => item.user.id)).toContain(oles.id)
      expect(sender.incoming.map((item) => item.user.id)).not.toContain(oles.id)
      expect(receiver.incoming.map((item) => item.user.id)).toContain(marta.id)
      expect(receiver.outgoing.map((item) => item.user.id)).not.toContain(marta.id)
    })

    it('запит самому собі — 400 FRIENDSHIP_SELF', async () => {
      const marta = await register('Самотній')

      const response = await request(app.getHttpServer())
        .post(url('/friends/requests'))
        .set('Cookie', marta.cookie)
        .send({ userId: marta.id })
        .expect(400)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_SELF)
    })

    it('неіснуючий користувач — 404', async () => {
      const marta = await register('Шукач')

      const response = await request(app.getHttpServer())
        .post(url('/friends/requests'))
        .set('Cookie', marta.cookie)
        .send({ userId: 'ckl0000000000000000000000' })
        .expect(404)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.NOT_FOUND)
    })

    it('повторний запит від того самого ініціатора — 409 FRIENDSHIP_EXISTS', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const response = await sendRequest(marta, oles).expect(409)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_EXISTS)
    })

    it('запит до вже друга — 409 FRIENDSHIP_EXISTS', async () => {
      const [marta, oles] = await pair()

      await befriend(marta, oles)

      const response = await sendRequest(marta, oles).expect(409)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_EXISTS)
    })

    it('зустрічний запит означає згоду — пара одразу ACCEPTED', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const response = await sendRequest(oles, marta).expect(201)

      expect(friendshipStateResponseSchema.parse(response.body).relation).toBe('FRIENDS')
      expect(await friendIdsOf(marta)).toContain(oles.id)
      expect(await friendIdsOf(oles)).toContain(marta.id)
    })

    it('взаємний КОНКУРЕНТНИЙ запит: один рядок, статус ACCEPTED, жодної 5xx', async () => {
      const [marta, oles] = await pair()

      // Обидва натиснули «додати» одночасно. Унікальний індекс пропускає лише один
      // INSERT; той, хто програв, ловить P2002 ЗОВНІ транзакції, повторює її і
      // бачить уже створений рядок — тобто йде гілкою зустрічного запиту.
      const [first, second] = await Promise.all([
        sendRequest(marta, oles),
        sendRequest(oles, marta),
      ])

      for (const response of [first, second]) {
        expect(response.status).toBeLessThan(500)
      }

      const [userAId, userBId] = [marta.id, oles.id].sort()
      const rows = await prisma.friendship.findMany({ where: { userAId, userBId } })

      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('ACCEPTED')
      expect(await friendIdsOf(marta)).toContain(oles.id)
    })
  })

  describe('нормалізація пари (§4.3, інваріант §5.3.5)', () => {
    it('userAId < userBId незалежно від того, хто ініціював', async () => {
      const [one, other] = await pair()

      // Дві пари: в одній ініціює той, чий id менший, у другій — навпаки.
      const [lower, higher] = one.id < other.id ? [one, other] : [other, one]
      const [third, fourth] = await pair()
      const [lower2, higher2] = third.id < fourth.id ? [third, fourth] : [fourth, third]

      await sendRequest(lower, higher).expect(201)
      await sendRequest(higher2, lower2).expect(201)

      for (const [a, b] of [
        [lower, higher],
        [lower2, higher2],
      ]) {
        const row = await rowOf(a!, b!)

        expect(row).not.toBeNull()
        expect(row!.userAId < row!.userBId).toBe(true)
        expect(row!.userAId).toBe(a!.id)
      }

      // Ініціатор зберігається окремо і НЕ виводиться з A/B.
      const reversed = await rowOf(lower2, higher2)

      expect(reversed!.requestedById).toBe(higher2.id)
    })
  })

  describe('PATCH /friends/requests/:id', () => {
    it('отримувач приймає запит — обидва стають друзями', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { incoming } = await requestsOf(oles)
      const invitation = incoming.find((item) => item.user.id === marta.id)!

      const response = await respond(oles, invitation.id, 'accept').expect(200)

      expect(friendshipStateResponseSchema.parse(response.body).relation).toBe('FRIENDS')
      expect(await friendIdsOf(marta)).toContain(oles.id)
      expect(await friendIdsOf(oles)).toContain(marta.id)

      // Прийнятий запит зникає зі списків очікування в обох.
      expect((await requestsOf(marta)).outgoing.map((item) => item.user.id)).not.toContain(oles.id)
      expect((await requestsOf(oles)).incoming.map((item) => item.user.id)).not.toContain(marta.id)
    })

    it('ініціатор не може прийняти власний запит — 403', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { outgoing } = await requestsOf(marta)
      const own = outgoing.find((item) => item.user.id === oles.id)!

      const response = await respond(marta, own.id, 'accept').expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FORBIDDEN)
    })

    it('відхилення лишає пару в DECLINED, і запит можна надіслати знову', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { incoming } = await requestsOf(oles)

      await respond(oles, incoming.find((item) => item.user.id === marta.id)!.id, 'decline').expect(
        200,
      )

      expect((await rowOf(marta, oles))!.status).toBe('DECLINED')
      expect(await friendIdsOf(marta)).not.toContain(oles.id)

      // DECLINED не вирок: §6.2 не дає способу його скасувати, тож повторний
      // запит мусить проходити.
      const again = await sendRequest(marta, oles).expect(201)

      expect(friendshipStateResponseSchema.parse(again.body).relation).toBe('REQUEST_SENT')
      expect((await rowOf(marta, oles))!.status).toBe('PENDING')
    })

    it('відхилений запит можна надіслати й у зворотному напрямку', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { incoming } = await requestsOf(oles)

      await respond(oles, incoming.find((item) => item.user.id === marta.id)!.id, 'decline').expect(
        200,
      )

      await sendRequest(oles, marta).expect(201)

      const row = await rowOf(marta, oles)

      expect(row!.status).toBe('PENDING')
      expect(row!.requestedById).toBe(oles.id)
    })

    it('чужий і неіснуючий запит — однаково 404', async () => {
      const [marta, oles] = await pair()
      const bohdan = await register('Сторонній')

      await sendRequest(marta, oles).expect(201)

      const { outgoing } = await requestsOf(marta)
      const invitation = outgoing.find((item) => item.user.id === oles.id)!

      // Сторонній не має знати навіть того, що такий рядок існує.
      await respond(bohdan, invitation.id, 'accept').expect(404)
      await respond(marta, 'ckl0000000000000000000000', 'accept').expect(404)
    })

    it('застарілий id не чіпає новий запит тієї самої пари', async () => {
      const [marta, oles] = await pair()

      // A: запит створено й скасовано.
      await sendRequest(marta, oles).expect(201)

      const staleId = (await requestsOf(marta)).outgoing.find(
        (item) => item.user.id === oles.id,
      )!.id

      await request(app.getHttpServer())
        .delete(url(`/friends/${oles.id}`))
        .set('Cookie', marta.cookie)
        .expect(204)

      // B: нова спроба тієї самої пари — інший рядок, інший id.
      await sendRequest(oles, marta).expect(201)

      const fresh = (await requestsOf(marta)).incoming.find((item) => item.user.id === oles.id)!

      expect(fresh.id).not.toBe(staleId)

      // PATCH зі старим id мусить дати 404. Раніше сервіс читав рядок за id поза
      // транзакцією, а змінював його за ПАРОЮ — тобто стара вкладка прийняла б
      // щойно створений чужий запит B.
      const response = await respond(marta, staleId, 'accept').expect(404)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.NOT_FOUND)

      // B лишився недоторканим: той самий id, той самий статус, той самий ініціатор.
      const row = await rowOf(marta, oles)

      expect(row!.id).toBe(fresh.id)
      expect(row!.status).toBe('PENDING')
      expect(row!.requestedById).toBe(oles.id)
      expect(row!.respondedAt).toBeNull()

      // І в списках B досі висить як вхідний, а не поїхав у друзі.
      expect(await friendIdsOf(marta)).not.toContain(oles.id)
      expect((await requestsOf(marta)).incoming.map((item) => item.id)).toContain(fresh.id)
    })

    it('застарілий id не чіпає навіть дружбу, що виникла після нього', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const staleId = (await requestsOf(marta)).outgoing.find(
        (item) => item.user.id === oles.id,
      )!.id

      await request(app.getHttpServer())
        .delete(url(`/friends/${oles.id}`))
        .set('Cookie', marta.cookie)
        .expect(204)

      await befriend(oles, marta)

      await respond(marta, staleId, 'decline').expect(404)

      // Дружба на місці — старий id не перевів її в DECLINED.
      expect((await rowOf(marta, oles))!.status).toBe('ACCEPTED')
      expect(await friendIdsOf(marta)).toContain(oles.id)
    })

    it('прийняти вже прийнятий запит — 409 FRIENDSHIP_INVALID_TRANSITION', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { incoming } = await requestsOf(oles)
      const invitation = incoming.find((item) => item.user.id === marta.id)!

      await respond(oles, invitation.id, 'accept').expect(200)

      const response = await respond(oles, invitation.id, 'accept').expect(409)

      expect(apiErrorSchema.parse(response.body).code).toBe(
        API_ERROR_CODES.FRIENDSHIP_INVALID_TRANSITION,
      )
    })
  })

  describe('DELETE /friends/:userId', () => {
    it('розриває дружбу з обох боків', async () => {
      const [marta, oles] = await pair()

      await befriend(marta, oles)

      await request(app.getHttpServer())
        .delete(url(`/friends/${oles.id}`))
        .set('Cookie', marta.cookie)
        .expect(204)

      expect(await friendIdsOf(marta)).not.toContain(oles.id)
      expect(await friendIdsOf(oles)).not.toContain(marta.id)
      expect(await rowOf(marta, oles)).toBeNull()
    })

    it('скасовує власний надісланий запит', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      await request(app.getHttpServer())
        .delete(url(`/friends/${oles.id}`))
        .set('Cookie', marta.cookie)
        .expect(204)

      expect((await requestsOf(oles)).incoming.map((item) => item.user.id)).not.toContain(marta.id)
    })

    it('звʼязку немає — 404', async () => {
      const [marta, oles] = await pair()

      const response = await request(app.getHttpServer())
        .delete(url(`/friends/${oles.id}`))
        .set('Cookie', marta.cookie)
        .expect(404)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.NOT_FOUND)
    })
  })

  describe('блокування (§6.2)', () => {
    async function block(actor: Account, target: Account): Promise<void> {
      await request(app.getHttpServer())
        .post(url(`/friends/${target.id}/block`))
        .set('Cookie', actor.cookie)
        .expect(204)
    }

    it.each(['незнайомі', 'з наявним запитом', 'з наявної дружби'])(
      'блокує %s',
      async (scenario) => {
        const [marta, oles] = await pair()

        if (scenario === 'з наявним запитом') await sendRequest(marta, oles).expect(201)
        if (scenario === 'з наявної дружби') await befriend(marta, oles)

        await block(marta, oles)

        const row = await rowOf(marta, oles)

        expect(row!.status).toBe('BLOCKED')
        expect(row!.blockedById).toBe(marta.id)
        expect(await friendIdsOf(marta)).not.toContain(oles.id)
        expect(await friendIdsOf(oles)).not.toContain(marta.id)
      },
    )

    it('заблокований не може надіслати запит — 403 FRIENDSHIP_BLOCKED', async () => {
      const [marta, oles] = await pair()

      await block(marta, oles)

      const response = await sendRequest(oles, marta).expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
    })

    it('той, хто заблокував, теж не може надіслати запит, не знявши блок', async () => {
      const [marta, oles] = await pair()

      await block(marta, oles)

      const response = await sendRequest(marta, oles).expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
    })

    it('заблокований не знімає блок сам — 403', async () => {
      const [marta, oles] = await pair()

      await block(marta, oles)

      const response = await request(app.getHttpServer())
        .delete(url(`/friends/${marta.id}`))
        .set('Cookie', oles.cookie)
        .expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
      expect((await rowOf(marta, oles))!.status).toBe('BLOCKED')
    })

    it('той, хто заблокував, знімає блок через DELETE — і пара знову доступна', async () => {
      const [marta, oles] = await pair()

      await block(marta, oles)

      await request(app.getHttpServer())
        .delete(url(`/friends/${oles.id}`))
        .set('Cookie', marta.cookie)
        .expect(204)

      expect(await rowOf(marta, oles)).toBeNull()

      await sendRequest(oles, marta).expect(201)
    })

    it('повторне блокування не проходить — стан уже BLOCKED', async () => {
      const [marta, oles] = await pair()

      await block(marta, oles)

      const response = await request(app.getHttpServer())
        .post(url(`/friends/${oles.id}/block`))
        .set('Cookie', marta.cookie)
        .expect(403)

      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.FRIENDSHIP_BLOCKED)
    })
  })

  describe('сповіщення (§7.3, §7.5)', () => {
    it('запит створює рівно один IN_APP Notification отримувачу', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const notifications = await notificationsFor(oles.id, 'FRIEND_REQUESTED')
      const row = await rowOf(marta, oles)

      expect(notifications).toHaveLength(1)
      expect(notifications[0]?.payload).toEqual({ actorId: marta.id, friendshipId: row!.id })

      // Ініціатор сповіщення про власну дію не отримує.
      expect(await notificationsFor(marta.id, 'FRIEND_REQUESTED')).toHaveLength(0)
    })

    it('згода створює FRIEND_ACCEPTED тому, хто просив', async () => {
      const [marta, oles] = await pair()

      await befriend(marta, oles)

      expect(await notificationsFor(marta.id, 'FRIEND_ACCEPTED')).toHaveLength(1)
      expect(await notificationsFor(oles.id, 'FRIEND_ACCEPTED')).toHaveLength(0)
    })

    it('відмова, блокування й видалення сповіщень не породжують (§7.5 їх не перелічує)', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { incoming } = await requestsOf(oles)

      await respond(oles, incoming.find((item) => item.user.id === marta.id)!.id, 'decline').expect(
        200,
      )
      await request(app.getHttpServer())
        .post(url(`/friends/${oles.id}/block`))
        .set('Cookie', marta.cookie)
        .expect(204)

      // Крім єдиного FRIEND_REQUESTED на початку — нічого.
      expect(await prisma.notification.count({ where: { userId: marta.id } })).toBe(0)
      expect(await prisma.notification.count({ where: { userId: oles.id } })).toBe(1)
    })

    it('NotificationDelivery не створюється — диспетчер це окремий етап', async () => {
      const [marta, oles] = await pair()

      await befriend(marta, oles)

      const notifications = await prisma.notification.findMany({
        where: { userId: { in: [marta.id, oles.id] } },
        select: { id: true },
      })

      expect(notifications.length).toBeGreaterThan(0)
      expect(
        await prisma.notificationDelivery.count({
          where: { notificationId: { in: notifications.map((item) => item.id) } },
        }),
      ).toBe(0)
    })

    it('відкинутий перехід не лишає сповіщення — запис справді в транзакції', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)
      await sendRequest(marta, oles).expect(409)

      expect(await notificationsFor(oles.id, 'FRIEND_REQUESTED')).toHaveLength(1)
    })
  })

  describe('GET /users — стан звʼязку в пошуку (§6.1)', () => {
    it('NONE для незнайомця', async () => {
      const [marta, oles] = await pair()

      expect(await relationTo(marta, oles)).toBe('NONE')
    })

    it('REQUEST_SENT / REQUEST_RECEIVED — по різні боки того самого запиту', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      expect(await relationTo(marta, oles)).toBe('REQUEST_SENT')
      expect(await relationTo(oles, marta)).toBe('REQUEST_RECEIVED')
    })

    it('FRIENDS з обох боків', async () => {
      const [marta, oles] = await pair()

      await befriend(marta, oles)

      expect(await relationTo(marta, oles)).toBe('FRIENDS')
      expect(await relationTo(oles, marta)).toBe('FRIENDS')
    })

    it('BLOCKED_BY_ME / BLOCKED_ME — саме це дає доступ до розблокування в UI', async () => {
      const [marta, oles] = await pair()

      await request(app.getHttpServer())
        .post(url(`/friends/${oles.id}/block`))
        .set('Cookie', marta.cookie)
        .expect(204)

      expect(await relationTo(marta, oles)).toBe('BLOCKED_BY_ME')
      expect(await relationTo(oles, marta)).toBe('BLOCKED_ME')
    })

    it('відхилений запит виглядає як NONE — він не заважає новому', async () => {
      const [marta, oles] = await pair()

      await sendRequest(marta, oles).expect(201)

      const { incoming } = await requestsOf(oles)

      await respond(oles, incoming.find((item) => item.user.id === marta.id)!.id, 'decline').expect(
        200,
      )

      expect(await relationTo(marta, oles)).toBe('NONE')
    })
  })

  describe('§5.2: видалення з друзів не скасовує активні лоани', () => {
    it('лоан у HANDED_OVER переживає розрив дружби', async () => {
      const [owner, borrower] = await pair()

      await befriend(owner, borrower)

      // Стейт-машина лоанів (§5) — наступний етап, тож єдиний доступний шлях
      // створити активний лоан сьогодні — вставити рядок напряму.
      const graph = await createGraph(prisma, { ownerId: owner.id, borrowerId: borrower.id })
      const loan = await prisma.loan.create({
        data: {
          copyId: graph.copyId,
          ownerId: owner.id,
          borrowerId: borrower.id,
          status: 'HANDED_OVER',
          handedAt: new Date(),
        },
      })

      await prisma.copy.update({
        where: { id: graph.copyId },
        data: { status: 'LENT_OUT', currentHolderId: borrower.id },
      })

      await request(app.getHttpServer())
        .delete(url(`/friends/${borrower.id}`))
        .set('Cookie', owner.cookie)
        .expect(204)

      // Дружби немає, фізична книжка — все ще в позичальника.
      expect(await rowOf(owner, borrower)).toBeNull()

      const afterLoan = await prisma.loan.findUnique({ where: { id: loan.id } })
      const afterCopy = await prisma.copy.findUnique({ where: { id: graph.copyId } })

      expect(afterLoan?.status).toBe('HANDED_OVER')
      expect(afterLoan?.returnedAt).toBeNull()
      expect(afterCopy?.status).toBe('LENT_OUT')
      expect(afterCopy?.currentHolderId).toBe(borrower.id)
    })

    it('те саме при блокуванні', async () => {
      const [owner, borrower] = await pair()

      await befriend(owner, borrower)

      const graph = await createGraph(prisma, { ownerId: owner.id, borrowerId: borrower.id })
      const loan = await prisma.loan.create({
        data: {
          copyId: graph.copyId,
          ownerId: owner.id,
          borrowerId: borrower.id,
          status: 'APPROVED',
        },
      })

      await request(app.getHttpServer())
        .post(url(`/friends/${borrower.id}/block`))
        .set('Cookie', owner.cookie)
        .expect(204)

      expect((await prisma.loan.findUnique({ where: { id: loan.id } }))?.status).toBe('APPROVED')
    })
  })
})
