import { z } from 'zod'
import { workAuthorSchema, workSchema } from './catalog'

/**
 * §6.5 і §8, підетап 7e.
 *
 * Вішлист адресує `Work`, а не `Edition`/`Copy`: «хочу прочитати цю книжку» не
 * залежить від того, яке саме видання зрештою трапиться в друга (§3).
 */

export const WISHLIST_LIMITS = {
  idMax: 64,
} as const

const idSchema = z.string().trim().min(1).max(WISHLIST_LIMITS.idMax)

/**
 * Пункт вішлиста разом із проєкцією твору — так само, як групи бібліотеки
 * несуть `work`+`authors` поруч, а не лише `workId`: список має що показати без
 * додаткового запиту по кожен рядок.
 */
export const wishlistItemSchema = z.object({
  id: z.string(),
  workId: z.string(),
  work: workSchema,
  authors: z.array(workAuthorSchema),
  createdAt: z.iso.datetime(),
})

export type WishlistItem = z.infer<typeof wishlistItemSchema>

export const wishlistResponseSchema = z.object({
  items: z.array(wishlistItemSchema),
})

export type WishlistResponse = z.infer<typeof wishlistResponseSchema>

export const wishlistItemResponseSchema = z.object({
  item: wishlistItemSchema,
})

export type WishlistItemResponse = z.infer<typeof wishlistItemResponseSchema>

/** §8: `POST /me/wishlist { workId }`. */
export const addWishlistItemRequestSchema = z.object({
  workId: idSchema,
})

export type AddWishlistItemRequest = z.infer<typeof addWishlistItemRequestSchema>
