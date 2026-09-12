import {
  assertIdentifierLength,
  assertSafeScratchDatabase,
  assertSafeTestDatabase,
  parseTarget,
} from './guard'

const WORK = 'postgresql://bookswap:dev@localhost:5432/bookswap?schema=public'
const TEST = 'postgresql://bookswap:dev@localhost:5432/bookswap_test?schema=public'

/** Оточення за замовчуванням — рівно те, що лежить у .env.example. */
function env(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      DATABASE_URL: WORK,
      DIRECT_DATABASE_URL: WORK,
      TEST_DATABASE_URL: TEST,
      ...overrides,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

describe('assertSafeTestDatabase', () => {
  it('пропускає локальну базу з суфіксом _test', () => {
    expect(assertSafeTestDatabase(env())).toEqual({ url: TEST, database: 'bookswap_test' })
  })

  it.each([
    ['127.0.0.1', 'postgresql://u:p@127.0.0.1:5432/bookswap_test'],
    ['::1', 'postgresql://u:p@[::1]:5432/bookswap_test'],
  ])('дозволяє петльовий хост %s', (_name, url) => {
    // Робоча база при цьому має бути іншою, інакше спрацює перевірка збігу:
    // localhost і 127.0.0.1 нормалізуються в один хост навмисно.
    const result = assertSafeTestDatabase(
      env({ TEST_DATABASE_URL: url, DATABASE_URL: WORK, DIRECT_DATABASE_URL: WORK }),
    )

    expect(result.database).toBe('bookswap_test')
  })

  it('відхиляє базу без суфікса _test', () => {
    expect(() =>
      assertSafeTestDatabase(
        env({ TEST_DATABASE_URL: 'postgresql://u:p@localhost:5432/bookswap' }),
      ),
    ).toThrow(/_test/)
  })

  it.each(['postgres', 'template0', 'template1'])('відхиляє службову базу %s', (name) => {
    expect(() =>
      assertSafeTestDatabase(env({ TEST_DATABASE_URL: `postgresql://u:p@localhost:5432/${name}` })),
    ).toThrow(/службову базу/)
  })

  it('відхиляє віддалений хост, навіть якщо назва бази правильна', () => {
    expect(() =>
      assertSafeTestDatabase(
        env({ TEST_DATABASE_URL: 'postgresql://u:p@db.prod.example.com:5432/bookswap_test' }),
      ),
    ).toThrow(/лише на localhost/)
  })

  it.each([
    ['лапка', 'bookswap_test%22'],
    ['крапка з комою і DROP', 'bookswap_test%22%3B%20DROP%20DATABASE%20bookswap%3B--'],
    ['пробіл', 'bookswap%20test'],
    ['крапка', 'public.bookswap_test'],
    ['дефіс', 'bookswap-test'],
  ])('відхиляє назву з %s', (_name, encoded) => {
    expect(() =>
      assertSafeTestDatabase(
        env({ TEST_DATABASE_URL: `postgresql://u:p@localhost:5432/${encoded}` }),
      ),
    ).toThrow(/не відповідає|не вказано назву бази/)
  })

  it('відхиляє слеш у шляху — це вже не одна назва бази', () => {
    expect(() =>
      assertSafeTestDatabase(
        env({ TEST_DATABASE_URL: 'postgresql://u:p@localhost:5432/public/bookswap_test' }),
      ),
    ).toThrow(/не відповідає/)
  })

  it('відхиляє збіг із DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(env({ DATABASE_URL: TEST }))).toThrow(
      /ту саму базу, що й DATABASE_URL/,
    )
  })

  it('відхиляє збіг із DIRECT_DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(env({ DIRECT_DATABASE_URL: TEST }))).toThrow(
      /ту саму базу, що й DIRECT_DATABASE_URL/,
    )
  })

  it('ловить збіг, записаний іншим рядком: 127.0.0.1 проти localhost і неявний порт', () => {
    expect(() =>
      assertSafeTestDatabase(
        env({
          TEST_DATABASE_URL: 'postgresql://u:p@localhost:5432/bookswap_test',
          DIRECT_DATABASE_URL: 'postgresql://other:secret@127.0.0.1/bookswap_test?sslmode=require',
        }),
      ),
    ).toThrow(/ту саму базу/)
  })

  it.each(['TEST_DATABASE_URL', 'DATABASE_URL', 'DIRECT_DATABASE_URL'])(
    'вимагає %s — мовчазного фолбеку немає',
    (name) => {
      expect(() => assertSafeTestDatabase(env({ [name]: undefined }))).toThrow(
        new RegExp(`${name} не задано`),
      )
    },
  )

  it('відхиляє URL іншого протоколу', () => {
    expect(() =>
      assertSafeTestDatabase(
        env({ TEST_DATABASE_URL: 'mysql://u:p@localhost:3306/bookswap_test' }),
      ),
    ).toThrow(/postgresql/)
  })

  it('відхиляє те, що взагалі не є URL', () => {
    expect(() => assertSafeTestDatabase(env({ TEST_DATABASE_URL: 'bookswap_test' }))).toThrow(
      /не є коректним URL/,
    )
  })
})

describe('parseTarget', () => {
  it('нормалізує хост, порт за замовчуванням і відкидає query-параметри', () => {
    expect(parseTarget('postgresql://u:p@127.0.0.1/bookswap_test?schema=public', 'X')).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'bookswap_test',
    })
  })

  it('віддалений хост лишається собою і не зводиться до localhost', () => {
    expect(parseTarget('postgresql://u:p@DB.Example.COM:6432/app', 'X')).toEqual({
      host: 'db.example.com',
      port: 6432,
      database: 'app',
    })
  })
})

describe('assertIdentifierLength', () => {
  it("пропускає ім'я рівно на межі — 63 байти", () => {
    const name = 'a'.repeat(63)

    expect(() => assertIdentifierLength(name, 'X')).not.toThrow()
  })

  it("відхиляє ім'я на один байт довше межі", () => {
    const name = 'a'.repeat(64)

    expect(() => assertIdentifierLength(name, 'X')).toThrow(/64.*63-byte|63-byte.*64/)
  })

  it('counts UTF-8 bytes, not characters — Cyrillic is wider than ASCII', () => {
    // Each Cyrillic letter is 2 bytes in UTF-8: 32 characters = 64 bytes,
    // over the limit, even though the string's own length (JS .length) is
    // only 32.
    const name = 'а'.repeat(32)

    expect(name).toHaveLength(32)
    expect(() => assertIdentifierLength(name, 'X')).toThrow(/64 bytes/)
  })
})

/**
 * Stage 8e-1 (migration-scratch guard): pure tests, no connection at all —
 * the same trick as `assertSafeTestDatabase` above: fake URLs are passed as
 * plain parameters, not through `.env`/`process.env`, so these tests prove
 * the refusal happens BEFORE any SQL, not just "usually works out that way".
 */
describe('assertSafeScratchDatabase', () => {
  const DEV = 'postgresql://bookswap:dev@localhost:5432/bookswap'
  const DIRECT = 'postgresql://bookswap:dev@localhost:5432/bookswap'
  const SHARED_TEST = 'postgresql://bookswap:dev@localhost:5432/bookswap_test'
  const SCRATCH = 'postgresql://bookswap:dev@localhost:5432/bookswap_migration_scratch_default_test'

  function protectedTargets(overrides: Partial<Record<'dev' | 'direct' | 'shared', string>> = {}) {
    return [
      { label: 'DATABASE_URL (dev)', url: overrides.dev ?? DEV },
      { label: 'DIRECT_DATABASE_URL (dev)', url: overrides.direct ?? DIRECT },
      { label: 'TEST_DATABASE_URL (shared)', url: overrides.shared ?? SHARED_TEST },
    ]
  }

  it('приймає валідний scratch-target, відмінний від усіх захищених', () => {
    expect(assertSafeScratchDatabase(SCRATCH, 'scratch', protectedTargets())).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'bookswap_migration_scratch_default_test',
    })
  })

  it('відхиляє збіг зі спільним TEST_DATABASE_URL', () => {
    // The candidate happens to match what got passed as "shared" — exactly
    // the risk a full normalized check catches and a substring check would not.
    expect(() => assertSafeScratchDatabase(SHARED_TEST, 'scratch', protectedTargets())).toThrow(
      /TEST_DATABASE_URL \(shared\)/,
    )
  })

  it('відхиляє збіг із DATABASE_URL (dev)', () => {
    expect(() => assertSafeScratchDatabase(DEV, 'scratch', protectedTargets())).toThrow(
      /DATABASE_URL \(dev\)/,
    )
  })

  it('відхиляє збіг із DIRECT_DATABASE_URL (dev)', () => {
    const candidate = 'postgresql://other:secret@localhost:5432/bookswap'

    expect(() => assertSafeScratchDatabase(candidate, 'scratch', protectedTargets())).toThrow(
      /DATABASE_URL \(dev\)/,
    )
  })

  it('еквівалентні localhost-адреси ловляться попри інший запис: 127.0.0.1, неявний порт, інший юзер', () => {
    const candidate = 'postgresql://someone:else@127.0.0.1/bookswap_test?sslmode=require'

    expect(() => assertSafeScratchDatabase(candidate, 'scratch', protectedTargets())).toThrow(
      /TEST_DATABASE_URL \(shared\)/,
    )
  })

  it('еквівалентні localhost-адреси: ::1 проти localhost', () => {
    const candidate = 'postgresql://u:p@[::1]:5432/bookswap'

    expect(() => assertSafeScratchDatabase(candidate, 'scratch', protectedTargets())).toThrow(
      /DATABASE_URL \(dev\)/,
    )
  })

  it('відхиляє службову базу навіть без жодного збігу з protectedTargets', () => {
    const candidate = 'postgresql://u:p@localhost:5432/postgres'

    expect(() => assertSafeScratchDatabase(candidate, 'scratch', [])).toThrow(
      /reserved system database/,
    )
  })

  it('відхиляє віддалений хост', () => {
    const candidate = 'postgresql://u:p@db.prod.example.com:5432/bookswap_migration_scratch_test'

    expect(() => assertSafeScratchDatabase(candidate, 'scratch', [])).toThrow(/localhost/)
  })

  it("відхиляє ім'я бази за межею довжини ідентифікатора PostgreSQL — ДО SQL", () => {
    const longName = `bookswap_migration_scratch_${'x'.repeat(40)}_test`
    const candidate = `postgresql://u:p@localhost:5432/${longName}`

    expect(() => assertSafeScratchDatabase(candidate, 'scratch', [])).toThrow(/63-byte/)
  })

  it('порожній масив protectedTargets усе одно ловить reserved і довжину, але не dev/direct/shared', () => {
    expect(assertSafeScratchDatabase(DEV, 'scratch', [])).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'bookswap',
    })
  })
})
