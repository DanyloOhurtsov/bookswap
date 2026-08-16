import { z } from 'zod'

/**
 * §4.4, enum'и каталогу.
 *
 * Як `Visibility` і `FriendshipStatus`, значення дублюють Prisma-enum'и з
 * `apps/api`: `packages/shared` не має права залежати від згенерованого клієнта
 * (§12.1). Розсинхрон ловиться на боці API — див.
 * `apps/api/src/common/enum-parity.spec.ts`.
 */
export const AUTHOR_ROLE = ['AUTHOR', 'CO_AUTHOR', 'EDITOR', 'ILLUSTRATOR'] as const

export const authorRoleSchema = z.enum(AUTHOR_ROLE)

export type AuthorRole = z.infer<typeof authorRoleSchema>

export const EDITION_FORMAT = ['HARDCOVER', 'PAPERBACK', 'POCKET'] as const

export const editionFormatSchema = z.enum(EDITION_FORMAT)

export type EditionFormat = z.infer<typeof editionFormatSchema>
