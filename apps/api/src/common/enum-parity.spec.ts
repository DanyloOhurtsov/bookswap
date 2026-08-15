import { VISIBILITY, type Visibility as SharedVisibility } from '@bookswap/shared'
import { Visibility as PrismaVisibility } from '../generated/prisma/enums'
import type { Visibility as PrismaVisibilityType } from '../generated/prisma/enums'

/**
 * `packages/shared` не має права імпортувати згенерований Prisma Client (§12.1),
 * тож значення enum'а описані там окремо. Це єдина точка, де можливий розсинхрон
 * між доменом і контрактом, — і вона перевіряється тут, з обох боків.
 */

/** Компіляційна перевірка: типи взаємно присвоювані, тобто множини значень збігаються. */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _typesMatch: Equal<SharedVisibility, PrismaVisibilityType> = true

describe('Visibility: shared ↔ Prisma', () => {
  it('містить ті самі значення', () => {
    expect([...VISIBILITY].sort()).toEqual(Object.values(PrismaVisibility).sort())
  })

  it('типи взаємно присвоювані', () => {
    expect(_typesMatch).toBe(true)
  })

  it('відповідає §4.2', () => {
    expect([...VISIBILITY].sort()).toEqual(['FRIENDS', 'PRIVATE', 'PUBLIC'])
  })
})
