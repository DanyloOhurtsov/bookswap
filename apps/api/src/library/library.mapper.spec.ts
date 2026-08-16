import {
  groupByEdition,
  isHome,
  toBorrowedCopy,
  toOwnCopy,
  toVisibleCopy,
  type CopyRow,
} from './library.mapper'

/**
 * §9 у частині «що саме віддається назовні» перевіряється тут — чистими
 * функціями, без PostgreSQL. Ключова вимога етапу: приватні поля не повертаються
 * з API, а не ховаються в UI. Тому нижче перевіряється **відсутність** ключів, а
 * не їхнє значення: `note: null` у відповіді теж був би витоком — він каже, що
 * нотатки немає.
 */

const MARTA = { id: 'user-marta', displayName: 'Марта', avatarUrl: null }
const OLES = { id: 'user-oles', displayName: 'Олесь', avatarUrl: 'https://example.com/o.png' }

function copyRow(overrides: Partial<CopyRow> = {}): CopyRow {
  return {
    id: 'copy-1',
    ownerId: MARTA.id,
    currentHolderId: MARTA.id,
    status: 'AVAILABLE',
    visibility: 'FRIENDS',
    condition: 'GOOD',
    note: 'кавова пляма на 213-й',
    acquiredAt: new Date('2026-03-01T00:00:00.000Z'),
    createdAt: new Date('2026-03-02T10:00:00.000Z'),
    owner: MARTA,
    currentHolder: MARTA,
    edition: {
      id: 'edition-1',
      workId: 'work-1',
      translationId: 'translation-1',
      publisher: 'КСД',
      year: 2019,
      isbn13: '9786171262737',
      pageCount: 800,
      coverUrl: null,
      format: 'HARDCOVER',
      translation: { lang: 'uk', translator: 'Любов Пилаєва' },
      work: {
        id: 'work-1',
        title: 'Шантарам',
        origLang: 'en',
        firstPubYear: 2003,
        description: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        authors: [
          { role: 'AUTHOR', author: { id: 'a-1', name: 'Ґреґорі Робертс', nameLatin: null } },
        ],
      },
    },
    ...overrides,
  }
}

const lentOut = (): CopyRow =>
  copyRow({ id: 'copy-2', status: 'LENT_OUT', currentHolderId: OLES.id, currentHolder: OLES })

describe('isHome', () => {
  it('вдома — це тримач, який дорівнює власнику (інваріант §5.3.2)', () => {
    expect(isHome(copyRow())).toBe(true)
    expect(isHome(lentOut())).toBe(false)
  })
})

describe('toOwnCopy', () => {
  it('власник бачить нотатку, дату придбання й видимість', () => {
    const copy = toOwnCopy(copyRow())

    expect(copy.note).toBe('кавова пляма на 213-й')
    expect(copy.acquiredAt).toBe('2026-03-01')
    expect(copy.visibility).toBe('FRIENDS')
  })

  it('дата придбання — без часу', () => {
    expect(toOwnCopy(copyRow()).acquiredAt).not.toContain('T')
    expect(toOwnCopy(copyRow({ acquiredAt: null })).acquiredAt).toBeNull()
  })

  it('вдома тримача немає, поза домом — є', () => {
    expect(toOwnCopy(copyRow()).holder).toBeNull()
    expect(toOwnCopy(lentOut()).holder).toEqual(OLES)
  })

  it('власник бачить імʼя тримача незалежно від власного showHolderNames (§6.6)', () => {
    // Прапорець керує тим, що бачать ІНШІ; сюди він не передається взагалі —
    // саме тому в `toOwnCopy` немає відповідного параметра.
    expect(toOwnCopy(lentOut()).holder?.displayName).toBe('Олесь')
  })
})

describe('toVisibleCopy', () => {
  it('не віддає приватних полів власника (§9)', () => {
    const copy = toVisibleCopy(copyRow(), true)

    expect(copy).not.toHaveProperty('note')
    expect(copy).not.toHaveProperty('acquiredAt')
    expect(copy).not.toHaveProperty('visibility')
    expect(copy).not.toHaveProperty('createdAt')
  })

  it('віддає те, що потрібно для рішення «просити чи ні» (§6.5)', () => {
    const copy = toVisibleCopy(lentOut(), true)

    expect(copy.status).toBe('LENT_OUT')
    expect(copy.condition).toBe('GOOD')
    expect(copy.isHome).toBe(false)
  })

  it('імʼя тримача приховується, коли §6.6 не дозволяє — але статус лишається', () => {
    const hidden = toVisibleCopy(lentOut(), false)

    expect(hidden.holder).toBeNull()
    expect(hidden.isHome).toBe(false)
  })

  it('вдома тримача немає навіть з дозволеними іменами — це власник', () => {
    expect(toVisibleCopy(copyRow(), true).holder).toBeNull()
  })
})

describe('toBorrowedCopy', () => {
  it('показує власника — інакше незрозуміло, кому повертати', () => {
    expect(toBorrowedCopy(copyRow()).owner).toEqual(MARTA)
  })

  it('не віддає нотаток власника: книжка в мене — не доступ до його записів', () => {
    const copy = toBorrowedCopy(copyRow())

    expect(copy).not.toHaveProperty('note')
    expect(copy).not.toHaveProperty('visibility')
    expect(copy).not.toHaveProperty('acquiredAt')
  })
})

describe('groupByEdition', () => {
  it('складає примірники одного видання в одну групу, не втрачаючи жодного (§3)', () => {
    const groups = groupByEdition(
      [copyRow(), copyRow({ id: 'copy-2' }), copyRow({ id: 'copy-3' })],
      toOwnCopy,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.copies.map((copy) => copy.id)).toEqual(['copy-1', 'copy-2', 'copy-3'])
    expect(groups[0]?.counts).toEqual({ total: 3, home: 3, out: 0 })
  })

  it('рахує «×3 · 2 вдома, 1 у Марка» (§6.4)', () => {
    const groups = groupByEdition([copyRow(), copyRow({ id: 'copy-3' }), lentOut()], toOwnCopy)

    expect(groups[0]?.counts).toEqual({ total: 3, home: 2, out: 1 })
  })

  it('розділяє різні видання', () => {
    const other = copyRow({
      id: 'copy-9',
      edition: { ...copyRow().edition, id: 'edition-2', publisher: 'Астролябія', year: 2021 },
    })

    expect(groupByEdition([copyRow(), other], toOwnCopy)).toHaveLength(2)
  })

  it('віддає обчислені поля видання: мову перекладу й перекладача', () => {
    const [group] = groupByEdition([copyRow()], toOwnCopy)

    expect(group?.edition.lang).toBe('uk')
    expect(group?.edition.translator).toBe('Любов Пилаєва')
  })

  it('для видання мовою оригіналу мова береться з твору, перекладача немає', () => {
    const original = copyRow({
      edition: { ...copyRow().edition, translationId: null, translation: null },
    })
    const [group] = groupByEdition([original], toOwnCopy)

    expect(group?.edition.lang).toBe('en')
    expect(group?.edition.translator).toBeNull()
  })

  it('порожній список — це порожній список, а не помилка', () => {
    expect(groupByEdition([], toOwnCopy)).toEqual([])
  })

  it('лічильники чужої бібліотеки рахують лише видимі примірники', () => {
    // Приховані примірники сюди просто не потрапляють — їх відфільтровує §9 до
    // групування. Інакше «×3» на сторінці друга розкривало б наявність книжок,
    // які він сховав.
    const groups = groupByEdition([copyRow()], (copy) => toVisibleCopy(copy, false))

    expect(groups[0]?.counts).toEqual({ total: 1, home: 1, out: 0 })
  })
})
