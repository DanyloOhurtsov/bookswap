import { envSchema, validateEnv } from './env.validation'

describe('validateEnv', () => {
  it('не вимагає DATABASE_URL — API стартує до підключення Prisma', () => {
    const result = validateEnv({ NODE_ENV: 'test' })

    expect(result.PORT).toBe(3001)
    expect(result.WEB_ORIGIN).toBe('http://localhost:3000')
  })

  it('приводить PORT із рядка до числа', () => {
    expect(validateEnv({ PORT: '4000' }).PORT).toBe(4000)
  })

  it('зберігає ще не описані схемою змінні', () => {
    const result = validateEnv({
      DATABASE_URL: 'postgresql://bookswap:dev@localhost:5432/bookswap',
    })

    expect(result.DATABASE_URL).toBe('postgresql://bookswap:dev@localhost:5432/bookswap')
  })

  it('падає на старті при некоректному значенні, а не мовчки бере дефолт', () => {
    expect(() => validateEnv({ PORT: 'not-a-port' })).toThrow(/Некоректне оточення/)
    expect(() => validateEnv({ WEB_ORIGIN: 'локалхост' })).toThrow(/Некоректне оточення/)
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/Некоректне оточення/)
  })

  it('дефолти схеми відповідають .env.example', () => {
    const parsed = envSchema.parse({})

    expect(parsed).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
    })
  })
})
