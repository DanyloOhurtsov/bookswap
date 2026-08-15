import { FRIENDSHIP_STATUS, VISIBILITY } from '@bookswap/shared'
import type {
  FriendshipStatus as SharedFriendshipStatus,
  Visibility as SharedVisibility,
} from '@bookswap/shared'
import {
  FriendshipStatus as PrismaFriendshipStatus,
  Visibility as PrismaVisibility,
} from '../generated/prisma/enums'
import type {
  FriendshipStatus as PrismaFriendshipStatusType,
  Visibility as PrismaVisibilityType,
} from '../generated/prisma/enums'

/**
 * `packages/shared` не має права імпортувати згенерований Prisma Client (§12.1),
 * тож значення enum'ів описані там окремо. Це єдина точка, де можливий розсинхрон
 * між доменом і контрактом, — і вона перевіряється тут, з обох боків.
 */

/** Компіляційна перевірка: типи взаємно присвоювані, тобто множини значень збігаються. */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _visibilityMatches: Equal<SharedVisibility, PrismaVisibilityType> = true
const _friendshipStatusMatches: Equal<SharedFriendshipStatus, PrismaFriendshipStatusType> = true

describe('Visibility: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...VISIBILITY].sort()).toEqual(Object.values(PrismaVisibility).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_visibilityMatches).toBe(true)
  })

  it('відповідає §4.2', () => {
    expect([...VISIBILITY].sort()).toEqual(['FRIENDS', 'PRIVATE', 'PUBLIC'])
  })
})

describe('FriendshipStatus: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...FRIENDSHIP_STATUS].sort()).toEqual(Object.values(PrismaFriendshipStatus).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_friendshipStatusMatches).toBe(true)
  })

  it('відповідає §4.3', () => {
    expect([...FRIENDSHIP_STATUS].sort()).toEqual(['ACCEPTED', 'BLOCKED', 'DECLINED', 'PENDING'])
  })
})
