import { COPY_STATUS } from '../domain/copy'
import {
  addCopyRequestSchema,
  borrowedCopySchema,
  libraryQueryRequestSchema,
  ownCopySchema,
  updateCopyRequestSchema,
  visibleCopySchema,
} from './library'

const owner = { id: 'user-1', displayName: 'Марта', avatarUrl: null }

const rawCopy = {
  id: 'copy-1',
  status: 'AVAILABLE',
  visibility: 'FRIENDS',
  condition: 'GOOD',
  note: 'кавова пляма на 200-й',
  acquiredAt: '2026-03-01',
  createdAt: '2026-03-01T10:00:00.000Z',
  isHome: true,
  holder: null,
  owner,
}

describe('addCopyRequestSchema', () => {
  it('вимагає лише editionId — решта має дефолти в базі', () => {
    expect(addCopyRequestSchema.parse({ editionId: 'edition-1' })).toEqual({
      editionId: 'edition-1',
    })
  })

  it('не має поля «кількість»: кожен фізичний примірник — окремий Copy (§3)', () => {
    const parsed = addCopyRequestSchema.parse({ editionId: 'edition-1', quantity: 3 })

    expect(parsed).not.toHaveProperty('quantity')
  })

  it('приймає дату придбання без часу', () => {
    expect(
      addCopyRequestSchema.parse({ editionId: 'e-1', acquiredAt: '2026-03-01' }).acquiredAt,
    ).toBe('2026-03-01')
    expect(
      addCopyRequestSchema.safeParse({ editionId: 'e-1', acquiredAt: '2026-03-01T10:00:00.000Z' })
        .success,
    ).toBe(false)
  })
})

describe('updateCopyRequestSchema', () => {
  it('вимагає хоча б одне поле', () => {
    expect(updateCopyRequestSchema.safeParse({}).success).toBe(false)
  })

  it('дозволяє прибрати нотатку явним null', () => {
    expect(updateCopyRequestSchema.parse({ note: null }).note).toBeNull()
  })

  it.each(['AVAILABLE', 'UNAVAILABLE'])('приймає status=%s — це осі власника', (status) => {
    expect(updateCopyRequestSchema.parse({ status }).status).toBe(status)
  })

  it.each(['RESERVED', 'LENT_OUT'])(
    'відхиляє status=%s: цим станом керує лише стейт-машина §5',
    (status) => {
      expect(updateCopyRequestSchema.safeParse({ status }).success).toBe(false)
    },
  )

  it('не дає перепризначити власника чи тримача', () => {
    const parsed = updateCopyRequestSchema.parse({
      note: 'нова нотатка',
      ownerId: 'user-2',
      currentHolderId: 'user-2',
    })

    expect(parsed).not.toHaveProperty('ownerId')
    expect(parsed).not.toHaveProperty('currentHolderId')
  })
})

describe('libraryQueryRequestSchema', () => {
  it.each([...COPY_STATUS])('фільтрує за status=%s', (status) => {
    expect(libraryQueryRequestSchema.parse({ status }).status).toBe(status)
  })

  it('усі фільтри опційні', () => {
    expect(libraryQueryRequestSchema.parse({})).toEqual({})
  })

  it('валідує мову як ISO 639-1', () => {
    expect(libraryQueryRequestSchema.safeParse({ lang: 'zz' }).success).toBe(false)
  })
})

describe('проєкції примірника', () => {
  it('власник бачить нотатку й дату придбання', () => {
    const parsed = ownCopySchema.parse(rawCopy)

    expect(parsed.note).toBe('кавова пляма на 200-й')
    expect(parsed.acquiredAt).toBe('2026-03-01')
  })

  it('чужий примірник не несе приватних полів власника (§9)', () => {
    const parsed = visibleCopySchema.parse(rawCopy)

    expect(parsed).not.toHaveProperty('note')
    expect(parsed).not.toHaveProperty('acquiredAt')
    expect(parsed).not.toHaveProperty('visibility')
    expect(parsed).not.toHaveProperty('createdAt')
  })

  it('позичена мною книжка показує власника, але не його нотатки', () => {
    const parsed = borrowedCopySchema.parse(rawCopy)

    expect(parsed.owner).toEqual(owner)
    expect(parsed).not.toHaveProperty('note')
    expect(parsed).not.toHaveProperty('visibility')
  })
})
