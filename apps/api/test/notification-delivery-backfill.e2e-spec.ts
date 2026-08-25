import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import 'reflect-metadata'
import request from 'supertest'
import { notificationListResponseSchema } from '@bookswap/shared'
import { createTestApp } from './auth.helpers'
import { registerAccount, url } from './loan.helpers'
import { NotificationsService } from '../src/notifications/notifications.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/** Точний текст міграції, яку побачить прод, — не переказ. */
const MIGRATION_SQL = readFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20260818090000_backfill_legacy_in_app_deliveries/migration.sql',
  ),
  'utf8',
)

/**
 * Upgrade-шлях: база на стані етапу 5 → міграція бекфілу (§7.6).
 *
 * `list`/`markRead`/`readAll` фільтрують за наявністю `IN_APP`-доставки, а
 * `Notification`, записані до появи `NotificationDelivery` (стейт-машина §5.1
 * писала їх з першого дня, задовго до диспетчера), такої доставки не мають.
 * Без бекфілу вони назавжди зникають із центру сповіщень — не через помилку
 * запису, а через розрив між старими даними й новою умовою читання.
 *
 * Тест виконує СПРАВЖНІЙ текст файлу міграції (`readFileSync`, не переписаний
 * SQL): розбіжність між тим, що тестується, і тим, що покотиться в прод, —
 * гірша за відсутність тесту.
 */
describe('Backfill IN_APP-доставок для Notification етапу 5 (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * Рядок «як зі стейт-машини етапу 5»: `prisma.notification.create()` напряму,
   * в обхід `NotificationsService`, — так виглядав будь-який запис до появи
   * `NotificationDelivery`. Час подачі свідомо в минулому: `sentAt` після
   * бекфілу мусить збігтися з ним, а не з моментом застосування міграції.
   */
  async function legacyNotification(userId: string): Promise<{ id: string; createdAt: Date }> {
    const createdAt = new Date('2026-06-01T10:00:00.000Z')

    return prisma.notification.create({
      data: {
        userId,
        type: 'LOAN_REQUESTED',
        payload: { loanId: 'legacy-loan', copyId: 'legacy-copy', actorId: 'legacy-actor' },
        createdAt,
      },
      select: { id: true, createdAt: true },
    })
  }

  function deliveriesOf(notificationId: string) {
    return prisma.notificationDelivery.findMany({ where: { notificationId } })
  }

  it('легасі-подія без доставки невидима, доки не застосована міграція', async () => {
    const account = await registerAccount(app, 'backfill-before')
    const legacy = await legacyNotification(account.id)

    expect(await deliveriesOf(legacy.id)).toHaveLength(0)

    const response = await request(app.getHttpServer())
      .get(url('/me/notifications'))
      .set('Cookie', account.cookie)
      .expect(200)

    const body = notificationListResponseSchema.parse(response.body)

    expect(body.notifications.map((item) => item.id)).not.toContain(legacy.id)
  })

  it('міграція ідемпотентна: другий прогін нічого не додає', async () => {
    const account = await registerAccount(app, 'backfill-idempotent')
    const legacy = await legacyNotification(account.id)

    await prisma.$executeRawUnsafe(MIGRATION_SQL)
    expect(await deliveriesOf(legacy.id)).toHaveLength(1)

    // Другий прогін — той самий текст, що й перший. WHERE NOT EXISTS має
    // виключити вже забезпечену подію.
    await prisma.$executeRawUnsafe(MIGRATION_SQL)
    expect(await deliveriesOf(legacy.id)).toHaveLength(1)
  })

  it('після бекфілу доставка — SENT, sentAt узгоджений із моментом події', async () => {
    const account = await registerAccount(app, 'backfill-fields')
    const legacy = await legacyNotification(account.id)

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    const [delivery] = await deliveriesOf(legacy.id)

    expect(delivery?.channel).toBe('IN_APP')
    expect(delivery?.status).toBe('SENT')
    expect(delivery?.sentAt?.toISOString()).toBe(legacy.createdAt.toISOString())
    expect(delivery?.attempts).toBe(0)
    expect(delivery?.error).toBeNull()
    // Явно згенерований id, а не лишений порожнім — інакше вставка впала б на
    // NOT NULL первинного ключа ще до WHERE NOT EXISTS.
    expect(delivery?.id.length).toBeGreaterThan(0)
  })

  it('після міграції подія доступна через list, markRead і readAll', async () => {
    const account = await registerAccount(app, 'backfill-visible')
    const legacy = await legacyNotification(account.id)

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    const list = await request(app.getHttpServer())
      .get(url('/me/notifications'))
      .set('Cookie', account.cookie)
      .expect(200)
    const listed = notificationListResponseSchema.parse(list.body)

    expect(listed.notifications.map((item) => item.id)).toContain(legacy.id)
    expect(listed.unreadCount).toBeGreaterThanOrEqual(1)

    await request(app.getHttpServer())
      .patch(url(`/me/notifications/${legacy.id}/read`))
      .set('Cookie', account.cookie)
      .expect(200)

    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: legacy.id } })).readAt,
    ).not.toBeNull()

    const second = await legacyNotification(account.id)

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    const readAll = await request(app.getHttpServer())
      .post(url('/me/notifications/read-all'))
      .set('Cookie', account.cookie)
      .expect(200)

    expect((readAll.body as { updated: number }).updated).toBeGreaterThanOrEqual(1)
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: second.id } })).readAt,
    ).not.toBeNull()
  })

  /** Подія, яка вже має IN_APP-доставку (звичайний шлях), міграція не чіпає. */
  it('не створює другої IN_APP-доставки для подій, записаних НОВИМ шляхом', async () => {
    const account = await registerAccount(app, 'backfill-untouched')
    const notifications = app.get(NotificationsService)

    await notifications.create({
      userId: account.id,
      type: 'LOAN_REQUESTED',
      payload: { loanId: 'fresh-loan', copyId: 'fresh-copy' },
    })

    const fresh = await prisma.notification.findFirstOrThrow({
      where: { userId: account.id },
      orderBy: { createdAt: 'desc' },
    })

    expect(await deliveriesOf(fresh.id)).toHaveLength(1)

    await prisma.$executeRawUnsafe(MIGRATION_SQL)

    expect(await deliveriesOf(fresh.id)).toHaveLength(1)
  })
})
