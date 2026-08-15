import { Test } from '@nestjs/testing'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { DevEmailSender } from '../src/email/dev-email-sender'

export interface TestAppOptions {
  /**
   * `false` вимикає throttler: ліміт реєстрацій — п'ять на годину (§11), а
   * сценаріїв у більшості файлів більше. Те, що ліміт справді працює, перевіряє
   * окремий `rate-limit.e2e-spec.ts` на застосунку зі справжнім guard'ом.
   */
  withRateLimit?: boolean
  /**
   * Те саме, що зробить `main.ts` у production. Без явного значення
   * `configureApp` дивиться на NODE_ENV, а в тестах він `test` — тобто вимкнено.
   */
  trustProxy?: boolean
}

/**
 * Піднімає застосунок так само, як `main.ts` — через `configureApp`, тобто з
 * реальними pipe, фільтром і cookie-parser'ом.
 */
export async function createTestApp({
  withRateLimit = false,
  trustProxy = false,
}: TestAppOptions = {}): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({ imports: [AppModule] })

  if (!withRateLimit) {
    builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
  }

  const moduleRef = await builder.compile()
  const app = moduleRef.createNestApplication<INestApplication<App>>()

  configureApp(app, { trustProxy })
  await app.init()

  return app
}

let counter = 0

/** Унікальна адреса на кожен виклик: e2e-файли ділять одну тестову базу. */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1

  return `${prefix}-${String(counter)}-${String(process.pid)}@example.com`
}

export const VALID_PASSWORD = 'dovhyj-parol-2026'

/** `set-cookie` завжди масив рядків; типи supertest про це не знають. */
export function cookiesOf(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie']

  if (Array.isArray(raw)) return raw.map(String)

  return typeof raw === 'string' ? [raw] : []
}

export function sessionCookie(headers: Record<string, unknown>): string {
  const cookie = cookiesOf(headers).find((value) => value.startsWith('bookswap_session='))

  if (cookie === undefined) throw new Error('Відповідь не містить session-кукі')

  // Для наступних запитів потрібна лише пара name=value, без атрибутів.
  return cookie.split(';')[0] ?? ''
}

/**
 * Дістає одноразовий токен із листа. Той самий шлях, яким користується розробник
 * локально: подивитися, що пішло в пошту, і взяти посилання.
 */
export function tokenFromLastEmail(email: DevEmailSender, to: string): string {
  const message = email.lastTo(to)

  if (message === undefined) throw new Error(`Лист на ${to} не надсилався`)

  const match = /token=([A-Za-z0-9_-]+)/.exec(message.body)

  if (match?.[1] === undefined) throw new Error('У листі немає токена')

  return match[1]
}
