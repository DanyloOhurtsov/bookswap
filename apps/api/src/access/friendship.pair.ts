import type { FriendRelation, FriendshipStatus } from '@bookswap/shared'

/**
 * Чиста робота з парою користувачів. Ні Prisma, ні Nest — саме тому нормалізацію
 * A/B і виведення ролей можна покрити тестом повністю й без бази.
 *
 * Лежить в `access/`, а не в `friends/`, бо цим користуються обидва боки: читання
 * (`AccessService` — «чи ми друзі», «чи заблоковано») і запис (`FriendsService` —
 * переходи). Одна копія на два боки; дві розійшлися б у першому ж крайньому випадку.
 */

/**
 * Мінімальний зріз рядка `Friendship`, потрібний цим функціям.
 *
 * Описаний структурно, а не як `FriendshipModel`: чистий модуль не має залежати
 * від згенерованого клієнта, а модель Prisma присвоювана цьому типу за побудовою.
 */
export interface FriendshipRecord {
  userAId: string
  userBId: string
  status: FriendshipStatus
  requestedById: string
  blockedById: string | null
}

export interface Pair {
  userAId: string
  userBId: string
}

/** Стан пари. `NONE` означає, що рядка немає — це повноцінний стан, а не «нічого». */
export type FriendshipState = FriendshipStatus | 'NONE'

/**
 * Роль того, хто діє, відносно рядка.
 *
 * Рахується від `requestedById` / `blockedById`, а НЕ від того, хто з пари A, а
 * хто B: §4.3 прямо розділяє ці дві речі, бо порядок A/B задає сортування id.
 */
export type ActorRole =
  /** Рядка немає — ролі ще не існує. */
  | 'NONE'
  /** Ініціатор запиту. */
  | 'REQUESTER'
  /** Той, кому запит надіслали. */
  | 'RECIPIENT'
  /** Той, хто заблокував. */
  | 'BLOCKER'
  /** Той, кого заблокували. */
  | 'BLOCKED'

/**
 * §4.3 та інваріант §5.3.5: `userAId < userBId` лексикографічно.
 *
 * Це і є та нормалізація, яка прибирає `OR`-умови з кожної перевірки «чи ми
 * друзі». Ініціатор тут не бере участі взагалі — він зберігається окремо, в
 * `requestedById`; сплутати ці дві речі означає отримати два рядки на одну пару.
 *
 * Ту саму умову тримає CHECK `friendship_ab_ordered` у БД — код і база кажуть
 * одне й те саме, і жодне з двох не є єдиною лінією оборони.
 */
export function normalizePair(oneId: string, otherId: string): Pair {
  if (oneId === otherId) {
    throw new Error('normalizePair: пара із самим собою неможлива')
  }

  return oneId < otherId
    ? { userAId: oneId, userBId: otherId }
    : { userAId: otherId, userBId: oneId }
}

/** Другий учасник пари. Кидає, якщо переданого в парі немає — це помилка виклику. */
export function otherIdOf(
  friendship: Pick<FriendshipRecord, 'userAId' | 'userBId'>,
  userId: string,
): string {
  if (friendship.userAId === userId) return friendship.userBId
  if (friendship.userBId === userId) return friendship.userAId

  throw new Error('otherIdOf: користувач не належить до цієї пари')
}

export function isMember(
  friendship: Pick<FriendshipRecord, 'userAId' | 'userBId'>,
  userId: string,
): boolean {
  return friendship.userAId === userId || friendship.userBId === userId
}

export function stateOf(friendship: FriendshipRecord | null): FriendshipState {
  return friendship === null ? 'NONE' : friendship.status
}

export function actorRoleOf(friendship: FriendshipRecord | null, actorId: string): ActorRole {
  if (friendship === null) return 'NONE'

  if (friendship.status === 'BLOCKED') {
    return friendship.blockedById === actorId ? 'BLOCKER' : 'BLOCKED'
  }

  return friendship.requestedById === actorId ? 'REQUESTER' : 'RECIPIENT'
}

/**
 * Стан пари з погляду конкретної людини — те, що API віддає назовні замість
 * сирого `FriendshipStatus`.
 *
 * `DECLINED` перетворюється на `NONE` навмисно: відхилений запит не заважає
 * надіслати новий, тож для інтерфейсу він нічим не відрізняється від «звʼязку немає».
 */
export function relationOf(friendship: FriendshipRecord | null, viewerId: string): FriendRelation {
  if (friendship === null) return 'NONE'

  switch (friendship.status) {
    case 'ACCEPTED':
      return 'FRIENDS'
    case 'PENDING':
      return friendship.requestedById === viewerId ? 'REQUEST_SENT' : 'REQUEST_RECEIVED'
    case 'BLOCKED':
      return friendship.blockedById === viewerId ? 'BLOCKED_BY_ME' : 'BLOCKED_ME'
    case 'DECLINED':
      return 'NONE'
  }
}
