import {
  addWishlistItemRequestSchema,
  wishlistItemResponseSchema,
  wishlistItemSchema,
  wishlistResponseSchema,
} from './wishlist'

const work = {
  id: 'work-1',
  title: 'Шантарам',
  origLang: 'en',
  firstPubYear: 2003,
  description: null,
  createdAt: '2026-03-01T10:00:00.000Z',
}

const item = {
  id: 'wish-1',
  workId: work.id,
  work,
  authors: [{ id: 'author-1', name: 'Ґреґорі Девід Робертс', nameLatin: null, role: 'AUTHOR' }],
  createdAt: '2026-03-01T10:00:00.000Z',
}

describe('addWishlistItemRequestSchema', () => {
  it('приймає id твору', () => {
    expect(addWishlistItemRequestSchema.parse({ workId: 'work-1' })).toEqual({
      workId: 'work-1',
    })
  })

  it('обрізає пробіли', () => {
    expect(addWishlistItemRequestSchema.parse({ workId: ' work-1 ' })).toEqual({
      workId: 'work-1',
    })
  })

  it('відхиляє порожній і надто довгий id', () => {
    expect(addWishlistItemRequestSchema.safeParse({ workId: '' }).success).toBe(false)
    expect(addWishlistItemRequestSchema.safeParse({ workId: '   ' }).success).toBe(false)
    expect(addWishlistItemRequestSchema.safeParse({ workId: 'x'.repeat(65) }).success).toBe(false)
  })

  it('відхиляє відсутнє поле', () => {
    expect(addWishlistItemRequestSchema.safeParse({}).success).toBe(false)
  })
})

describe('wishlistItemSchema', () => {
  it('приймає пункт разом із твором і авторами', () => {
    expect(wishlistItemSchema.parse(item)).toEqual(item)
  })
})

describe('wishlistResponseSchema', () => {
  it('приймає список', () => {
    expect(wishlistResponseSchema.safeParse({ items: [item] }).success).toBe(true)
  })

  it('приймає порожній список — це валідна відповідь, а не помилка', () => {
    expect(wishlistResponseSchema.safeParse({ items: [] }).success).toBe(true)
  })
})

describe('wishlistItemResponseSchema', () => {
  it('приймає один пункт', () => {
    expect(wishlistItemResponseSchema.safeParse({ item }).success).toBe(true)
  })
})
