import { z } from 'zod'

/**
 * Валідація оточення на старті, fail-fast.
 *
 * Свідомо НЕ вимагає `DATABASE_URL` / `DIRECT_DATABASE_URL`: Prisma підключається
 * наступним етапом, і до того часу API мусить стартувати без запущеної бази.
 * Змінні присутні в `.env.example` як документація до docker-compose, не як вимога.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
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
