import { z } from 'zod'

/**
 * §4.2, enum `Visibility`.
 *
 * Значення дублюють Prisma-enum з `apps/api`, і це свідомо: `packages/shared`
 * не має права залежати від згенерованого клієнта, інакше фронт потягне за собою
 * весь ORM (§12.1). Розсинхрон ловиться на боці API перевіркою присвоюваності —
 * див. `apps/api/src/common/enum-parity.spec.ts`.
 */
export const VISIBILITY = ['PUBLIC', 'FRIENDS', 'PRIVATE'] as const

export const visibilitySchema = z.enum(VISIBILITY)

export type Visibility = z.infer<typeof visibilitySchema>
