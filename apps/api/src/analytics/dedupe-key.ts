import { createHash } from 'node:crypto'

/**
 * docs/plan/stage-8-activation.md, §2.2 — opaque/pseudonymous, БЕЗ секретної солі.
 * Мета не криптографічний захист, а (1) приховати сирий domain ID від прямого
 * читання `ProductEvent` і (2) дати детермінований ключ ідемпотентності для
 * after-commit виклику (§3). Це НЕ анонімізація: хто вже знає `domainEntityId` і
 * `subjectUserId`, може порахувати той самий хеш і підтвердити збіг.
 *
 * Чиста функція, без Prisma й без Nest — тестується так само, як
 * `friendship.transitions.ts`/`loan.transitions.ts`.
 *
 * `subjectUserId` для подій Stage 8a завжди заповнений реальним user id.
 * Маркер `"-"` — стабільний рядок для майбутніх (поза 8a) подій без суб'єкта;
 * функція не валідує це поле — воно лише конкатенується в хеш, тож `"-"`
 * проходить так само, як будь-який інший рядок.
 */
export function computeDedupeKey(
  eventType: string,
  domainEntityId: string,
  subjectUserId: string,
): string {
  return createHash('sha256')
    .update(`bookswap-product-event:v1:${eventType}:${domainEntityId}:${subjectUserId}`)
    .digest('hex')
}
