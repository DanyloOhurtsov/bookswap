import { assertSafeTestDatabase, parseTarget } from './guard'

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
