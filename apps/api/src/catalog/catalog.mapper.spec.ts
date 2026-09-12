import { byEditionOrder, toEdition, toWork, toWorkAuthors, type EditionRow } from './catalog.mapper'
import { escapeLikePattern } from './search-text'
import type { Edition } from '@bookswap/shared'

const work = {
  id: 'work-1',
  title: 'Гобіт, або Туди і звідти',
  origLang: 'en',
  firstPubYear: 1937,
  description: null,
  createdAt: new Date('2026-01-01T12:00:00.000Z'),
  revision: 1,
}

function editionRow(overrides: Partial<EditionRow> = {}): EditionRow {
  return {
    id: 'edition-1',
    workId: 'work-1',
    translationId: 'translation-1',
    publisher: 'Астролябія',
    year: 2021,
    isbn13: '9786176642411',
    pageCount: 384,
    coverUrl: null,
    format: 'PAPERBACK',
    translation: { lang: 'uk', translator: 'Олена Оніщук' },
    revision: 1,
    ...overrides,
  }
}

describe('toWork', () => {
  it('віддає дату як ISO-рядок', () => {
    expect(toWork(work).createdAt).toBe('2026-01-01T12:00:00.000Z')
  })

  it('не тягне за собою полів рейтингу — §10 приїде на етапі оцінок', () => {
    const projected = toWork({ ...work })

    expect(projected).not.toHaveProperty('ratingAvg')
    expect(projected).not.toHaveProperty('titleNorm')
  })
})

describe('toWorkAuthors', () => {
  it('упорядковує за position — єдиним джерелом порядку (R10a)', () => {
    const authors = toWorkAuthors([
      { role: 'ILLUSTRATOR', position: 2, author: { id: 'a-3', name: 'Ярина', nameLatin: null } },
      { role: 'AUTHOR', position: 1, author: { id: 'a-2', name: 'Богдан', nameLatin: null } },
      { role: 'AUTHOR', position: 0, author: { id: 'a-1', name: 'Андрій', nameLatin: null } },
    ])

    expect(authors.map((author) => author.name)).toEqual(['Андрій', 'Богдан', 'Ярина'])
    expect(authors.map((author) => author.position)).toEqual([0, 1, 2])
  })

  /**
   * R10a: роль не перевизначає ручний порядок. Раніше `toWorkAuthors` сортувала
   * спершу за роллю — це навмисно більше не так: клієнт міг поставити
   * ILLUSTRATOR першим, і `position` це зберігає.
   */
  it('роль не перевизначає position, навіть якщо це виглядає «не за роллю»', () => {
    const authors = toWorkAuthors([
      { role: 'AUTHOR', position: 1, author: { id: 'a-2', name: 'Богдан', nameLatin: null } },
      { role: 'ILLUSTRATOR', position: 0, author: { id: 'a-1', name: 'Андрій', nameLatin: null } },
    ])

    expect(authors.map((author) => author.role)).toEqual(['ILLUSTRATOR', 'AUTHOR'])
  })

  it('роль належить звʼязку, а не людині: та сама людина може бути двічі', () => {
    const authors = toWorkAuthors([
      { role: 'AUTHOR', position: 0, author: { id: 'a-1', name: 'Андрій', nameLatin: null } },
      { role: 'ILLUSTRATOR', position: 1, author: { id: 'a-1', name: 'Андрій', nameLatin: null } },
    ])

    expect(authors).toHaveLength(2)
    expect(authors.map((author) => author.role)).toEqual(['AUTHOR', 'ILLUSTRATOR'])
  })
})

describe('toEdition', () => {
  it('бере мову й перекладача з перекладу', () => {
    const edition = toEdition(editionRow(), work)

    expect(edition.lang).toBe('uk')
    expect(edition.translator).toBe('Олена Оніщук')
  })

  it('видання мовою оригіналу: мова з твору, перекладача немає (§4.4)', () => {
    const edition = toEdition(editionRow({ translationId: null, translation: null }), work)

    expect(edition.lang).toBe('en')
    expect(edition.translator).toBeNull()
  })
})

describe('byEditionOrder', () => {
  const edition = (overrides: Partial<Edition>): Edition => ({
    ...toEdition(editionRow(), work),
    ...overrides,
  })

  it('новіше — вище', () => {
    const sorted = [edition({ id: 'a', year: 1985 }), edition({ id: 'b', year: 2021 })].sort(
      byEditionOrder,
    )

    expect(sorted.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('без року — в кінець: невідомий рік не робить книжку найновішою', () => {
    const sorted = [
      edition({ id: 'a', year: null }),
      edition({ id: 'b', year: 1985 }),
      edition({ id: 'c', year: 2021 }),
    ].sort(byEditionOrder)

    expect(sorted.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('за однакового року — за видавництвом, далі за id: порядок детермінований', () => {
    const sorted = [
      edition({ id: 'b', year: 2021, publisher: 'Астролябія' }),
      edition({ id: 'a', year: 2021, publisher: 'Веселка' }),
      edition({ id: 'c', year: 2021, publisher: 'Астролябія' }),
    ].sort(byEditionOrder)

    expect(sorted.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('escapeLikePattern', () => {
  it('знешкоджує символи LIKE — інакше «100%» шукало б усе підряд', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })

  it('не чіпає звичайний текст', () => {
    expect(escapeLikePattern('шантарам')).toBe('шантарам')
  })
})
