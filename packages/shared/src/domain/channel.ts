import { z } from 'zod'

/**
 * §4.8, enum'и `Channel` і `DeliveryStatus`.
 *
 * Значення дублюють Prisma-enum'и — причина та сама, що в `domain/visibility.ts`.
 * Парність тримає `apps/api/src/common/enum-parity.spec.ts`.
 */
export const CHANNEL = ['IN_APP', 'EMAIL', 'TELEGRAM'] as const

export const channelSchema = z.enum(CHANNEL)

export type Channel = z.infer<typeof channelSchema>

/**
 * Канали, які користувач вмикає й вимикає (§7.6) — **усі три**.
 *
 * `IN_APP` тут повноправний. Спокуса виключити його («це ж просто список на
 * сторінці, він завжди увімкнений») виглядає нешкідливою, але робить матрицю
 * §7.6 неповною: людина, яка хоче отримувати щось лише в Telegram і не бачити
 * лічильника непрочитаних, такої можливості не має. Правильна модель — не
 * «IN_APP завжди», а «за замовчуванням увімкнений, і його теж можна вимкнути»;
 * центр сповіщень тоді показує рівно ті події, для яких `IN_APP`-доставка
 * створювалася.
 *
 * Псевдонім, а не окремий список: збіг із `CHANNEL` тут навмисний і мусить
 * лишатися очевидним.
 */
export const PREFERENCE_CHANNEL = CHANNEL

export const preferenceChannelSchema = channelSchema

export type PreferenceChannel = Channel

/** §4.8: стан однієї доставки. `PENDING` → `SENT` або (після 5 спроб) `FAILED`. */
export const DELIVERY_STATUS = ['PENDING', 'SENT', 'FAILED'] as const

export const deliveryStatusSchema = z.enum(DELIVERY_STATUS)

export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>
