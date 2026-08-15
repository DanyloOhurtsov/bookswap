/**
 * Запобіжник перед `DROP DATABASE`.
 *
 * `test/db/global-setup.ts` щоразу перестворює тестову базу — це навмисно, бо саме
 * так кожен прогін перевіряє, що чиста PostgreSQL приймає всі міграції з нуля.
 * Ціна такого підходу: одна помилка в `TEST_DATABASE_URL` знищує чужі дані.
 * Тому перевірка тут **fail-closed** — усе, що не дозволено явно, заборонене.
 *
 * Модуль навмисно не має жодних залежностей і нічого не підключає: він
 * покривається звичайними unit-тестами (`guard.spec.ts`), які їдуть у `pnpm test`
 * без запущеної PostgreSQL.
 */

/** Нормалізована адреса бази. Порівнюємо саме її, а не сирі рядки URL. */
export interface DatabaseTarget {
  host: string
  port: number
  database: string
}

/**
 * Дозволений формат назви тестової бази: латиниця, цифри та підкреслення, і
 * обов'язковий суфікс `_test`. Це whitelist, а не пошук поганих символів —
 * лапки, пробіли, слеші, крапки з комою та будь-які SQL-фрагменти не проходять
 * автоматично, бо їх просто немає в дозволеній множині.
 */
const TEST_DATABASE_NAME = /^[A-Za-z0-9_]+_test$/

/** Службові бази PostgreSQL. Під шаблон вище вони й так не підходять — перевірка дублює захист свідомо. */
const RESERVED_DATABASES = new Set(['postgres', 'template0', 'template1'])

/** Єдині хости, на яких дозволено автоматичний DROP. CI ходить на localhost. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const DEFAULT_PORT = 5432

/** Усі петльові адреси зводяться до одного токена: 127.0.0.1 і localhost — той самий сервер. */
function canonicalHost(host: string): string {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase()

  return LOOPBACK_HOSTS.has(bare) ? 'localhost' : bare
}

/**
 * Розбирає connection string у нормалізовану адресу.
 *
 * Назва бази декодується з percent-encoding ДО перевірки: інакше `bookswap_test%22`
 * пройшов би як валідний рядок, а в БД пішла б назва з лапкою.
 */
export function parseTarget(raw: string, label: string): DatabaseTarget {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} не є коректним URL`)
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${label}: очікується postgresql:// URL, отримано ${url.protocol}//`)
  }

  const path = url.pathname.replace(/^\//, '')

  let database: string

  try {
    database = decodeURIComponent(path)
  } catch {
    throw new Error(`${label}: назва бази містить некоректне percent-encoding`)
  }

  if (database === '') {
    throw new Error(`${label}: у URL не вказано назву бази`)
  }

  const port = url.port === '' ? DEFAULT_PORT : Number(url.port)

  return { host: canonicalHost(url.hostname), port, database }
}

function sameTarget(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database
}

function describe(target: DatabaseTarget): string {
  return `${target.host}:${String(target.port)}/${target.database}`
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]

  if (value === undefined || value === '') {
    throw new Error(`${name} не задано — скопіюй .env.example у .env`)
  }

  return value
}

/**
 * Перевіряє, що тестову базу можна безпечно дропнути й створити заново.
 *
 * Повертає назву бази, яку **дозволено** підставляти в SQL-ідентифікатор: вона
 * пройшла whitelist `^[A-Za-z0-9_]+_test$`, тобто не містить лапок, пробілів,
 * крапок з комою чи будь-чого іншого, що змінило б межі ідентифікатора.
 * Параметризувати `DROP DATABASE` неможливо — PostgreSQL не приймає плейсхолдери
 * в DDL для імен об'єктів, — тож інтерполяція тут не обхід захисту, а єдиний
 * доступний спосіб, і безпечним його робить саме ця функція.
 *
 * @throws якщо хоч одна умова не виконана — мовчазного фолбеку немає навмисно.
 */
export function assertSafeTestDatabase(env: Record<string, string | undefined>): {
  url: string
  database: string
} {
  const url = requireEnv(env, 'TEST_DATABASE_URL')
  const test = parseTarget(url, 'TEST_DATABASE_URL')

  // 1. Назва бази.
  if (RESERVED_DATABASES.has(test.database.toLowerCase())) {
    throw new Error(
      `TEST_DATABASE_URL вказує на службову базу «${test.database}» — автоматичний DROP заборонено`,
    )
  }

  if (!TEST_DATABASE_NAME.test(test.database)) {
    throw new Error(
      `TEST_DATABASE_URL: назва бази «${test.database}» не відповідає ^[A-Za-z0-9_]+_test$ — ` +
        'тести перестворюють базу і працюють лише з іменами, що закінчуються на _test',
    )
  }

  // 2. Збіг із робочими базами. Порівнюються нормалізовані host/port/database,
  //    бо той самий сервер описується різними рядками (localhost і 127.0.0.1,
  //    порт явний і за замовчуванням, різні креденшели та query-параметри).
  for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
    const other = parseTarget(requireEnv(env, name), name)

    if (sameTarget(test, other)) {
      throw new Error(
        `TEST_DATABASE_URL вказує на ту саму базу, що й ${name} (${describe(test)}) — ` +
          'тести знищили б робочі дані',
      )
    }
  }

  // 3. Хост. Дропати щось на віддаленому сервері автоматично не можна ніколи.
  if (test.host !== 'localhost') {
    throw new Error(
      `TEST_DATABASE_URL вказує на «${test.host}» — автоматичний DROP дозволено лише на ` +
        'localhost, 127.0.0.1 або ::1',
    )
  }

  return { url, database: test.database }
}
