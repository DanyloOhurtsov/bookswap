import { z } from 'zod'

/**
 * §4.3, enum `FriendshipStatus`.
 *
 * Як і `Visibility`, значення дублюють Prisma-enum з `apps/api`: `packages/shared`
 * не має права залежати від згенерованого клієнта (§12.1). Розсинхрон ловиться
 * на боці API — див. `apps/api/src/common/enum-parity.spec.ts`.
 *
 * Це стан **рядка**, а не стан пари з чийогось погляду, і назовні в API він не
 * віддається — див. `FRIEND_RELATION` нижче.
 */
export const FRIENDSHIP_STATUS = ['PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED'] as const

export const friendshipStatusSchema = z.enum(FRIENDSHIP_STATUS)

export type FriendshipStatus = z.infer<typeof friendshipStatusSchema>

/**
 * Стан пари **з погляду того, хто питає**. Саме це віддається назовні замість
 * `FriendshipStatus`.
 *
 * `PENDING` сам по собі не каже, яку кнопку малювати: «Прийняти» чи «Скасувати
 * запит». Щоб відповісти, потрібен ще `requestedById`. Змусити фронт складати ці
 * два поля означало б розкласти авторизаційну логіку по обидва боки мережі —
 * рівно те, чого цей етап уникає.
 *
 * Живе в `domain/`, а не в `contracts/friendship`, бо цим типом користуються два
 * різні контракти — дружби й пошуку людей. Інакше вийшов би цикл імпортів.
 */
export const FRIEND_RELATION = [
  /** Звʼязку немає. Сюди ж потрапляє відхилений запит: він не заважає надіслати новий. */
  'NONE',
  /** Я надіслав запит, відповіді ще немає. */
  'REQUEST_SENT',
  /** Мені надіслали запит. */
  'REQUEST_RECEIVED',
  /** Дружба підтверджена. */
  'FRIENDS',
  /** Я заблокував цю людину — і лише я можу зняти блок. */
  'BLOCKED_BY_ME',
  /**
   * Мене заблокували.
   *
   * Показується явно, а не ховається під `NONE`: інакше інтерфейс намалює кнопку
   * «Додати в друзі», яка гарантовано дасть 403. Кнопка, що мовчки не працює,
   * гірша за чесне «недоступно».
   */
  'BLOCKED_ME',
] as const

export const friendRelationSchema = z.enum(FRIEND_RELATION)

export type FriendRelation = z.infer<typeof friendRelationSchema>
