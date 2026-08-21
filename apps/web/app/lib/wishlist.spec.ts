import { isInWishlist, optimisticWishlistItem, withAdded, withRemoved } from './wishlist'
import type { Work, WishlistItem, WorkAuthor } from '@bookswap/shared'

const work: Work = {
  id: 'work-1',
  title: 'Кобзар',
  origLang: 'uk',
  firstPubYear: 1840,
  description: null,
  createdAt: '2024-01-01T00:00:00.000Z',
}

const authors: WorkAuthor[] = [
  { id: 'author-1', name: 'Тарас Шевченко', nameLatin: null, role: 'AUTHOR' },
]

function item(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 'item-1',
    workId: 'work-1',
    work,
    authors,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('isInWishlist', () => {
  it('бачить пункт за workId', () => {
    expect(isInWishlist([item()], 'work-1')).toBe(true)
  })

  it('порожній список — не член', () => {
    expect(isInWishlist([], 'work-1')).toBe(false)
  })
})

describe('withAdded', () => {
  it('додає новий пункт першим у список', () => {
    const existing = item({ id: 'item-2', workId: 'work-2' })

    expect(withAdded([existing], item())).toEqual([item(), existing])
  })

  it('не дублює вже наявний workId', () => {
    const before = [item()]

    expect(withAdded(before, item({ id: 'item-optimistic' }))).toEqual(before)
  })
})

describe('withRemoved', () => {
  it('прибирає пункт за workId', () => {
    expect(withRemoved([item()], 'work-1')).toEqual([])
  })

  it('відсутній workId — список без змін', () => {
    const before = [item()]

    expect(withRemoved(before, 'work-does-not-exist')).toEqual(before)
  })
})

describe('optimisticWishlistItem', () => {
  it('складає пункт із переданого твору й авторів', () => {
    const result = optimisticWishlistItem(work, authors)

    expect(result.workId).toBe(work.id)
    expect(result.work).toBe(work)
    expect(result.authors).toBe(authors)
    expect(result.id).toContain(work.id)
  })
})
