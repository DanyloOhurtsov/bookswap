import { z } from 'zod'

/**
 * Контракт `GET /api/v1/health`.
 *
 * Перший спільний контракт монорепо: `apps/api` формує ним відповідь, `apps/web`
 * нею ж розбирає отримане. Саме це підключення тримає §12.1 — фронт не імпортує
 * типи з `apps/api`.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
