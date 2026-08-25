import { Test, type TestingModuleBuilder } from '@nestjs/testing'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { BACKGROUND_MODE } from '../src/common/background'
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
  /**
   * Підміна провайдерів перед компіляцією модуля.
   *
   * Потрібна рівно одному сценарію — перевірці атомарності §7.3: щоб довести, що
   * падіння на записі сповіщення відкочує весь перехід, це падіння треба вміти
   * влаштувати. Гачок навмисно загальний і без замовчувань: усі наявні виклики
   * `createTestApp()` лишаються незмінними.
   */
  configure?: (builder: TestingModuleBuilder) => void
  /**
   * Чи працює фонова робота за розкладом (`NotificationDispatcher`,
   * `NotificationDigestService`, `SessionCleanupService`).
   *
   * За замовчуванням `false`, і це головне, що робить набір детермінованим.
   * e2e-файли ділять одну базу й один процес, а черга доставки фільтрується
   * ГЛОБАЛЬНО (`claim()`/`reap()` дивляться лише на `status`, `nextAttemptAt` і
   * `attempts`) — тож тик, що збігся з чужим файлом, підбирає й ретраїть чужі
   * доставки. Вимикач закриває обидва шляхи: і таймер, і `wake()`.
   *
   * Сервіси при цьому лишаються в графі — `createTestApp` має бути тим самим
   * застосунком, що й `main.ts`, а не його урізаною копією. Тест, якому прохід
   * потрібен по суті, кличе `run()` явно; `true` тут потрібне лише там, де
   * предметом перевірки є сам `wake()` (див. `graceful-shutdown.e2e-spec.ts`).
   */
  background?: boolean
}

/**
 * Піднімає застосунок так само, як `main.ts` — через `configureApp`, тобто з
 * реальними pipe, фільтром і cookie-parser'ом.
 */
export async function createTestApp({
  withRateLimit = false,
  trustProxy = false,
  configure,
  background = false,
}: TestAppOptions = {}): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({ imports: [AppModule] })

  if (!withRateLimit) {
    builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
  }

  builder.overrideProvider(BACKGROUND_MODE).useValue(background ? 'enabled' : 'disabled')

  configure?.(builder)

  const moduleRef = await builder.compile()
  const app = moduleRef.createNestApplication<INestApplication<App>>()

  configureApp(app, { trustProxy })

  // `listen(0)`, а не `init()`: один слухач на весь файл.
  //
  // Інакше слухача піднімає supertest — і закриває його після КОЖНОГО запиту
  // (`supertest/lib/test.js`: `serverAddress()` робить `app.listen(0)`, а
  // `end()` — `server.close()`). За прогін це тисячі циклів listen/close на
  // ефемерних портах. Живий слухач прибирає цикл цілком: `serverAddress()`
  // бачить готову адресу, `this._server` не виставляється, `close()` не
  // викликається жодного разу. До `main.ts` це ще й ближче — там теж `listen()`.
  //
  // Чого тут НЕМАЄ і що не варто дописувати «про всяк випадок»: keep-alive.
  // superagent за замовчуванням ходить із `agent: false`
  // (`superagent/lib/node/index.js`), тобто без пулу з'єднань — кожен запит це
  // окремий сокет, закритий одразу після відповіді. Зміряно прямо: за повний
  // прогін `http.globalAgent` не отримує жодного сокета в жодному з 35 файлів.
  //
  // Підстава для цієї правки — вимірювання, а не доведений механізм. Падіння
  // класу «клієнт не отримав коректної HTTP-відповіді» траплялися в 3 із 14
  // прогонів до неї й у 0 із 12 після. Чому саме — не встановлено: найімовірніше
  // з'єднання потрапляє на порт, чий сервер щойно зник, але прямого доказу
  // цього немає.
  await app.listen(0)

  return app
}

let counter = 0

/** Унікальна адреса на кожен виклик: e2e-файли ділять одну тестову базу. */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1

  return `${prefix}-${String(counter)}-${String(process.pid)}@example.com`
}

export const VALID_PASSWORD = 'dovhyj-parol-2026'

const isbnCounters = new Map<string, number>()

/**
 * FNV-1a, 32-біт. Детермінований (не `Math.random`, не timestamp) хеш рядка
 * `namespace` у стабільну область — саме тому колізія між двома конкретними
 * namespace або є, або її немає назавжди, і це можна довести раз тестом, а не
 * сподіватись на ймовірність при кожному прогоні.
 */
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/**
 * Валідний ISBN-13 (§11: Bookland-префікс 978/979 + контрольна сума EAN-13),
 * унікальний на кожен виклик у межах namespace. Між e2e-файлами гарантія діє
 * для набору namespace, який явно перевіряє `unique-isbn.spec.ts`.
 *
 * Namespace замінює стару process-global формулу з `process.pid`, яка
 * повторювала ISBN між ізольованими Jest spec-файлами. Його хеш дає
 * 6-цифрову область, а 3-цифровий лічильник — до 999 ISBN за прогін.
 * Довільні namespace теоретично можуть мати однаковий хеш-регіон, тому кожен
 * реальний caller треба додавати до перевіреного списку в
 * `unique-isbn.spec.ts`; поточні п'ять не колізять.
 */
export function uniqueIsbn13(namespace: string, bookland: '978' | '979' = '978'): string {
  const next = (isbnCounters.get(namespace) ?? 0) + 1

  if (next > 999) {
    throw new Error(`uniqueIsbn13: вичерпано лічильник (999) для namespace "${namespace}"`)
  }

  isbnCounters.set(namespace, next)

  const region = String(fnv1a32(namespace) % 1_000_000).padStart(6, '0')
  const body = `${bookland}${region}${String(next).padStart(3, '0')}`

  let sum = 0

  for (const [index, character] of [...body].entries()) {
    sum += Number(character) * (index % 2 === 0 ? 1 : 3)
  }

  return `${body}${String((10 - (sum % 10)) % 10)}`
}

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
