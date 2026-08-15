import type { Friend, FriendRequest } from '@bookswap/shared'
import { otherIdOf } from '../access/friendship.pair'
import { toPublicUser } from '../users/user.mapper'
import type { UserModel } from '../generated/prisma/models'

/**
 * Рядок пари разом з обома учасниками. Описано структурно, бо `include` Prisma
 * породжує анонімний тип, а звужувати його до згенерованих внутрішніх імен —
 * залежність від деталей клієнта.
 */
export interface FriendshipWithUsers {
  id: string
  userAId: string
  userBId: string
  requestedById: string
  createdAt: Date
  respondedAt: Date | null
  userA: Pick<UserModel, 'id' | 'displayName' | 'avatarUrl'>
  userB: Pick<UserModel, 'id' | 'displayName' | 'avatarUrl'>
}

/** Другий учасник пари — той, кого показуємо тому, хто дивиться. */
function counterpart(
  friendship: FriendshipWithUsers,
  viewerId: string,
): Pick<UserModel, 'id' | 'displayName' | 'avatarUrl'> {
  return otherIdOf(friendship, viewerId) === friendship.userAId
    ? friendship.userA
    : friendship.userB
}

export function toFriend(friendship: FriendshipWithUsers, viewerId: string): Friend {
  return {
    user: toPublicUser(counterpart(friendship, viewerId)),
    // `respondedAt` у рядку ACCEPTED проставляє сервіс переходів, але рядок міг
    // приїхати й із seed'а. Дата створення — найближче правдиве наближення, і
    // вона краща за `null` у контракті, який фронт мусив би окремо обробляти.
    friendsSince: (friendship.respondedAt ?? friendship.createdAt).toISOString(),
  }
}

export function toFriendRequest(friendship: FriendshipWithUsers, viewerId: string): FriendRequest {
  return {
    // §8 адресує запит, а не людину: саме цей id іде в PATCH /friends/requests/:id.
    id: friendship.id,
    user: toPublicUser(counterpart(friendship, viewerId)),
    createdAt: friendship.createdAt.toISOString(),
  }
}
