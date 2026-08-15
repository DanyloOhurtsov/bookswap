import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTestDatabase } from './guard'
import { PrismaClient } from '../../src/generated/prisma/client'

/** §12.2: `.env` — один, у корені. Шлях від файлу, бо cwd у Jest залежить від конфіга. */
loadDotenv({ path: resolve(__dirname, '../../../../.env'), quiet: true })

/**
 * Результат перевірки запам'ятовується на процес, і це не оптимізація.
 * `use-test-database.ts` після першого виклику підміняє `DATABASE_URL` на тестовий
 * — повторна перевірка побачила б збіг із `TEST_DATABASE_URL` і впала б. Тож
 * оточення звіряється рівно один раз: у первозданному вигляді, до будь-яких підмін.
 */
let checked: { url: string; database: string } | undefined

function safeTestDatabase(): { url: string; database: string } {
  checked ??= assertSafeTestDatabase(process.env)

  return checked
}

/**
 * Окрема база під тести. Її дропають і створюють заново на кожному прогоні
 * (`global-setup.ts`), тож dev-дані вона не чіпає, а міграції щоразу застосовуються
 * до чистої PostgreSQL — це і є перевірка критерію «приймає всі міграції з нуля».
 *
 * Саме тому доступ до неї йде тільки через `assertSafeTestDatabase` (`guard.ts`):
 * помилка в `TEST_DATABASE_URL` тут коштує знищених даних.
 */
export function testDatabaseUrl(): string {
  return safeTestDatabase().url
}

/** Підключення до maintenance-бази, з якої можна дропнути й створити тестову. */
export function maintenanceUrl(): string {
  const url = new URL(testDatabaseUrl())
  url.pathname = '/postgres'
  url.search = ''

  return url.toString()
}

/** Назва, що пройшла whitelist `^[A-Za-z0-9_]+_test$` — безпечна як SQL-ідентифікатор. */
export function testDatabaseName(): string {
  return safeTestDatabase().database
}

export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) })
}

/**
 * Порядок не має значення: CASCADE зносить залежні рядки сам. `TRUNCATE` замість
 * `deleteMany` — щоб не залежати від напрямку зовнішніх ключів, які тут якраз і
 * перевіряються.
 */
const TABLES = [
  'Loan',
  'Copy',
  'Edition',
  'Translation',
  'WorkAuthor',
  'Work',
  'Author',
  'Review',
  'TranslationRating',
  'WishlistItem',
  'NotificationDelivery',
  'NotificationPreference',
  'Notification',
  'TelegramLinkToken',
  'Friendship',
  'User',
] as const

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ')

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}
