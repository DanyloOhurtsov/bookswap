import { z } from 'zod'

/**
 * §4.5, enum'и примірника. Значення дублюють Prisma — причина та сама, що в
 * `domain/catalog.ts`.
 *
 * `status` і `visibility` — різні осі (§4.5): прихована книжка може бути
 * одночасно позиченою. Тому `CopyStatus` не має нічого спільного з `Visibility`
 * і живе окремим enum'ом.
 */
export const COPY_STATUS = ['AVAILABLE', 'RESERVED', 'LENT_OUT', 'UNAVAILABLE'] as const

export const copyStatusSchema = z.enum(COPY_STATUS)

export type CopyStatus = z.infer<typeof copyStatusSchema>

/**
 * Ті два стани, якими розпоряджається **власник**, а не стейт-машина §5.
 *
 * Це навмисно окремий список, а не звуження `COPY_STATUS` фільтром: він виражає
 * інше правило — не «які стани бувають», а «що власник має право проставити
 * руками». `RESERVED` і `LENT_OUT` виникають лише з переходів лоану (§5.1), тож
 * у тілі запиту вони відхиляються валідацією, а не бізнес-перевіркою.
 */
export const OWNER_COPY_STATUS = ['AVAILABLE', 'UNAVAILABLE'] as const

export const ownerCopyStatusSchema = z.enum(OWNER_COPY_STATUS)

export type OwnerCopyStatus = z.infer<typeof ownerCopyStatusSchema>

export const CONDITION = ['NEW', 'GOOD', 'WORN', 'DAMAGED'] as const

export const conditionSchema = z.enum(CONDITION)

export type Condition = z.infer<typeof conditionSchema>
