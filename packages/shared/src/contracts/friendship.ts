import { z } from 'zod'
import { friendRelationSchema } from '../domain/friendship'
import { publicUserSchema } from './user'

/**
 * §6.2 і §8, блок «Дружба».
 *
 * Назовні йде не `FriendshipStatus`, а `FriendRelation` — стан пари з погляду
 * того, хто питає. Чому саме так, описано в `domain/friendship.ts`.
 */

/** Запис у списку друзів. §9: про іншого видно лише імʼя та аватар. */
export const friendSchema = z.object({
  user: publicUserSchema,
  friendsSince: z.iso.datetime(),
})

export type Friend = z.infer<typeof friendSchema>

export const friendListResponseSchema = z.object({
  friends: z.array(friendSchema),
})

export type FriendListResponse = z.infer<typeof friendListResponseSchema>

/**
 * Запит у друзі. `id` — це id рядка `Friendship`, і саме він іде в
 * `PATCH /friends/requests/:id` (§8): ендпоінт адресує запит, а не людину.
 */
export const friendRequestSchema = z.object({
  id: z.string(),
  user: publicUserSchema,
  createdAt: z.iso.datetime(),
})

export type FriendRequest = z.infer<typeof friendRequestSchema>

/**
 * Вхідні й вихідні одним відгуком.
 *
 * Обидва списки завжди разом, бо сторінка показує їх разом і потребує узгодженого
 * зрізу: між двома окремими запитами хтось устигне прийняти запит, і людина
 * побачить його одночасно і серед вхідних, і серед друзів.
 */
export const friendRequestsResponseSchema = z.object({
  incoming: z.array(friendRequestSchema),
  outgoing: z.array(friendRequestSchema),
})

export type FriendRequestsResponse = z.infer<typeof friendRequestsResponseSchema>

/** Перевіряється як непорожній рядок розумної довжини: формат id — деталь БД, не контракту. */
export const userIdSchema = z.string().trim().min(1, 'Не вказано користувача').max(64)

export const createFriendRequestSchema = z.object({
  userId: userIdSchema,
})

export type CreateFriendRequest = z.infer<typeof createFriendRequestSchema>

export const FRIEND_REQUEST_ACTIONS = ['accept', 'decline'] as const

export const friendRequestActionSchema = z.enum(FRIEND_REQUEST_ACTIONS)

export type FriendRequestAction = z.infer<typeof friendRequestActionSchema>

/** §8: одне поле `action` замість двох ендпоінтів — усі переходи крізь одну точку. */
export const respondFriendRequestSchema = z.object({
  action: friendRequestActionSchema,
})

export type RespondFriendRequest = z.infer<typeof respondFriendRequestSchema>

/**
 * Відповідь на дію, що змінює звʼязок.
 *
 * Повертається `relation`, а не порожній 204: взаємний запит одразу дає `FRIENDS`
 * (обидві сторони висловили той самий намір), і фронт мусить це побачити, а не
 * припускати `REQUEST_SENT`.
 */
export const friendshipStateResponseSchema = z.object({
  relation: friendRelationSchema,
})

export type FriendshipStateResponse = z.infer<typeof friendshipStateResponseSchema>
