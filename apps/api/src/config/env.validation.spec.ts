import { envSchema, validateEnv } from './env.validation'

const DB_URL = 'postgresql://bookswap:dev@localhost:5432/bookswap?schema=public'

/** Мінімум, без якого застосунок не має стартувати. */
const required = { DATABASE_URL: DB_URL, DIRECT_DATABASE_URL: DB_URL }

describe('validateEnv', () => {
  it('заповнює дефолти для змінних без явного значення', () => {
    const result = validateEnv({ ...required, NODE_ENV: 'test' })

    expect(result.PORT).toBe(3001)
    expect(result.WEB_ORIGIN).toBe('http://localhost:3000')
  })

  it('приводить PORT із рядка до числа', () => {
    expect(validateEnv({ ...required, PORT: '4000' }).PORT).toBe(4000)
  })

  it('зберігає ще не описані схемою змінні', () => {
    const result = validateEnv({ ...required, TEST_DATABASE_URL: DB_URL })

    expect(result.TEST_DATABASE_URL).toBe(DB_URL)
  })

  it('вимагає обидва URL бази — дефолтів у них немає', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/)
    expect(() => validateEnv({ DATABASE_URL: DB_URL })).toThrow(/DIRECT_DATABASE_URL/)
  })

  it('не приймає URL іншого протоколу замість постгресівського', () => {
    expect(() => validateEnv({ ...required, DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow(
      /postgresql/,
    )
  })

  it('падає на старті при некоректному значенні, а не мовчки бере дефолт', () => {
    expect(() => validateEnv({ ...required, PORT: 'not-a-port' })).toThrow(/Некоректне оточення/)
    expect(() => validateEnv({ ...required, WEB_ORIGIN: 'локалхост' })).toThrow(
      /Некоректне оточення/,
    )
    expect(() => validateEnv({ ...required, NODE_ENV: 'staging' })).toThrow(/Некоректне оточення/)
  })

  it('дефолти схеми відповідають .env.example', () => {
    const parsed = envSchema.parse(required)

    expect(parsed).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: DB_URL,
      DIRECT_DATABASE_URL: DB_URL,
    })
  })
})
