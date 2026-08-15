import { z } from 'zod'

/**
 * Підключення до PostgreSQL. Схема лише перевіряє, що це схожий на постгресівський
 * URL — розбирати креденшели тут не наше діло, це робить драйвер.
 */
const postgresUrl = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'очікується postgresql:// URL',
  )

/**
 * Валідація оточення на старті, fail-fast.
 *
 * `TEST_DATABASE_URL` тут свідомо немає: вона потрібна лише `pnpm test:db` і не є
 * вимогою до застосунку. Невідомі ключі схема не відкидає, тож вона просто
 * проходить наскрізь.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  /** Рантайм-клієнт через драйвер-адаптер. У проді — через PgBouncer. */
  DATABASE_URL: postgresUrl,
  /**
   * §4.1: пряме підключення для міграцій. Дефолту немає навмисно — мовчазний
   * фолбек на `DATABASE_URL` означав би, що в проді міграції підуть через пулер
   * і зависнуть на advisory lock, а помітиться це лише під час деплою.
   */
  DIRECT_DATABASE_URL: postgresUrl,
})

export type Env = z.infer<typeof envSchema>

/**
 * Повертає вихідне оточення, збагачене розібраними та типізованими значеннями.
 * Невідомі ключі не відкидаються — інакше ConfigService втратив би все, що ще не
 * описане схемою (те саме `DATABASE_URL` на наступному етапі).
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const result = envSchema.safeParse(config)

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(`Некоректне оточення:\n${issues}`)
  }

  return { ...config, ...result.data }
}
