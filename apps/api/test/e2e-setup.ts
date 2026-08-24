import { createTestPrismaClient } from './db/test-database'
import type { PrismaClient } from '../src/generated/prisma/client'

/**
 * Інваріант ізоляції e2e-файлів: **на межі файлів у `NotificationDelivery` немає
 * нетермінальних рядків.**
 *
 * Навіщо. Тридцять п'ять файлів ділять одну базу й один процес, а черга доставки
 * фільтрується глобально: `claim()` бере будь-який `PENDING` із дозрілим
 * `nextAttemptAt`, `reap()` — будь-який `PENDING`, що вичерпав спроби. Ні там, ні
 * там немає нічого, що казало б «цей рядок мій». Тож файл, який ганяє
 * `dispatcher.run()`, підбирав би доставки, залишені сусідами.
 *
 * Розклад і `wake()` в e2e вимкнені (`createTestApp`, `common/background.ts`), тож
 * прохід може статися лише з явного `run()` усередині тесту. Цей модуль закриває
 * другу половину: кожен файл прибирає за собою, і жодному не лишається чужого.
 *
 * Чому саме тут, а не в кожному файлі. Хук у `setupFilesAfterEnv` реєструється в
 * кореневому блоці, а Jest виконує `beforeAll` ззовні всередину і `afterAll`
 * зсередини назовні. Тобто перевірка йде до `beforeAll` файлу (до підняття
 * застосунку), а прибирання — після його `afterAll` (після `app.close()` і після
 * всіх тверджень). Поки `notification-delivery-lease.e2e-spec.ts` міряє оренду,
 * fencing і `attempts`, значення в базі лишаються справжніми: цей модуль не
 * торкається жодного рядка, поки файл працює.
 *
 * Чому `UPDATE`, а не `DELETE`. Рядок лишається на місці, і міграція бекфілу
 * (`notification-delivery-backfill.e2e-spec.ts` виконує справжній `migration.sql`)
 * не починає бачити чужі `Notification` як «легасі без IN_APP-доставки». Читання
 * сповіщень від статусу теж не залежить: `NotificationsService.list()` фільтрує
 * за НАЯВНІСТЮ `IN_APP`-доставки.
 */

/** Видно в базі й у падінні гарда — щоб було ясно, звідки взявся цей `FAILED`. */
const SWEEP_ERROR = 'Прибрано після e2e-файлу: доставку залишили нетермінальною'

let prisma: PrismaClient | undefined

/** Одне підключення на файл, і лише якщо хук справді знадобився. */
function client(): PrismaClient {
  prisma ??= createTestPrismaClient()

  return prisma
}

beforeAll(async () => {
  const left = await client().notificationDelivery.count({ where: { status: 'PENDING' } })

  if (left > 0) {
    throw new Error(
      `Попередній e2e-файл лишив ${String(left)} нетермінальних доставок. ` +
        'Прибирання після нього не виконалося (файл упав до кінця `afterAll`?), ' +
        'і цей файл ганяв би чужу чергу. Дивись test/e2e-setup.ts.',
    )
  }
})

afterAll(async () => {
  try {
    await client().notificationDelivery.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'FAILED', error: SWEEP_ERROR, leaseToken: null, leaseUntil: null },
    })
  } finally {
    await client().$disconnect()
    prisma = undefined
  }
})
