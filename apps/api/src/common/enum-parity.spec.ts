import {
  AUTHOR_ROLE,
  CONDITION,
  COPY_STATUS,
  EDITION_FORMAT,
  FRIENDSHIP_STATUS,
  OWNER_COPY_STATUS,
  VISIBILITY,
} from '@bookswap/shared'
import type {
  AuthorRole as SharedAuthorRole,
  Condition as SharedCondition,
  CopyStatus as SharedCopyStatus,
  EditionFormat as SharedEditionFormat,
  FriendshipStatus as SharedFriendshipStatus,
  Visibility as SharedVisibility,
} from '@bookswap/shared'
import {
  AuthorRole as PrismaAuthorRole,
  Condition as PrismaCondition,
  CopyStatus as PrismaCopyStatus,
  EditionFormat as PrismaEditionFormat,
  FriendshipStatus as PrismaFriendshipStatus,
  Visibility as PrismaVisibility,
} from '../generated/prisma/enums'
import type {
  AuthorRole as PrismaAuthorRoleType,
  Condition as PrismaConditionType,
  CopyStatus as PrismaCopyStatusType,
  EditionFormat as PrismaEditionFormatType,
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
const _authorRoleMatches: Equal<SharedAuthorRole, PrismaAuthorRoleType> = true
const _editionFormatMatches: Equal<SharedEditionFormat, PrismaEditionFormatType> = true
const _copyStatusMatches: Equal<SharedCopyStatus, PrismaCopyStatusType> = true
const _conditionMatches: Equal<SharedCondition, PrismaConditionType> = true

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

describe('AuthorRole: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...AUTHOR_ROLE].sort()).toEqual(Object.values(PrismaAuthorRole).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_authorRoleMatches).toBe(true)
  })

  it('відповідає §4.4', () => {
    expect([...AUTHOR_ROLE].sort()).toEqual(['AUTHOR', 'CO_AUTHOR', 'EDITOR', 'ILLUSTRATOR'])
  })
})

describe('EditionFormat: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...EDITION_FORMAT].sort()).toEqual(Object.values(PrismaEditionFormat).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_editionFormatMatches).toBe(true)
  })

  it('відповідає §4.4', () => {
    expect([...EDITION_FORMAT].sort()).toEqual(['HARDCOVER', 'PAPERBACK', 'POCKET'])
  })
})

describe('CopyStatus: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...COPY_STATUS].sort()).toEqual(Object.values(PrismaCopyStatus).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_copyStatusMatches).toBe(true)
  })

  it('відповідає §4.5', () => {
    expect([...COPY_STATUS].sort()).toEqual(['AVAILABLE', 'LENT_OUT', 'RESERVED', 'UNAVAILABLE'])
  })

  /**
   * `OWNER_COPY_STATUS` навмисно **не** дзеркалить Prisma-enum: це не «які стани
   * бувають», а «що власник має право проставити руками». `RESERVED` і
   * `LENT_OUT` виникають лише з переходів §5.1, тож у контракті редагування
   * примірника їх немає — і саме це тут зафіксовано, щоб їх туди не додали.
   */
  it('власнику доступні лише AVAILABLE і UNAVAILABLE (§5.1)', () => {
    expect([...OWNER_COPY_STATUS].sort()).toEqual(['AVAILABLE', 'UNAVAILABLE'])

    for (const status of OWNER_COPY_STATUS) {
      expect(Object.values(PrismaCopyStatus)).toContain(status)
    }
  })
})

describe('Condition: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...CONDITION].sort()).toEqual(Object.values(PrismaCondition).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_conditionMatches).toBe(true)
  })

  it('відповідає §4.5', () => {
    expect([...CONDITION].sort()).toEqual(['DAMAGED', 'GOOD', 'NEW', 'WORN'])
  })
})
