import {
  applyOperations,
  beginOperation,
  isInWishlist,
  optimisticWishlistItem,
  reconcileOperations,
  withAdded,
  withCommittedOperation,
  withRemoved,
  withRolledBackOperation,
  type WishlistCommittedOperation,
  type WishlistOperation,
  type WishlistOperationIntent,
  type WishlistOperations,
  type WishlistPendingOperation,
} from './wishlist'
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

/**
 * Журнал операцій за workId (конкурентний прохід): заміна єдиного
 * `overlay: WishlistItem[]` зі спільним знімком «до» для відкату. Другий
 * прохід додав inverse-дії над `committed`: `beginOperation`/
 * `withRolledBackOperation` нижче несуть `previous`, щоб провал inverse-дії
 * повертав ПОПЕРЕДНІЙ committed-стан, а не оголював запис.
 */
describe('журнал операцій вішлиста', () => {
  const itemA = item({ id: 'item-a', workId: 'work-a' })
  const itemB = item({ id: 'item-b', workId: 'work-b' })

  const removeIntent: WishlistOperationIntent = { kind: 'remove' }

  function addIntent(optimisticItem: WishlistItem): WishlistOperationIntent {
    return { kind: 'add', item: optimisticItem }
  }

  function committed(intent: WishlistOperationIntent): WishlistCommittedOperation {
    return { status: 'committed', intent }
  }

  function pending(
    intent: WishlistOperationIntent,
    previous?: WishlistCommittedOperation,
  ): WishlistPendingOperation {
    return { status: 'pending', intent, previous }
  }

  describe('beginOperation', () => {
    it('нічого нема — заводить pending, previous undefined', () => {
      const result = beginOperation(new Map(), 'work-a', removeIntent)

      expect(result.started).toBe(true)
      expect(result.operations.get('work-a')).toEqual(pending(removeIntent))
    })

    it('вже pending (той самий kind) — відмова, журнал без змін', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent)],
      ])

      const result = beginOperation(operations, 'work-a', removeIntent)

      expect(result.started).toBe(false)
      expect(result.operations).toBe(operations)
    })

    it('вже pending (inverse kind) — теж відмова: поки pending, workId заблокований повністю', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(addIntent(itemA))],
      ])

      const result = beginOperation(operations, 'work-a', removeIntent)

      expect(result.started).toBe(false)
    })

    it('committed із тим самим kind — відмова: дія вже досягнута, дублювати HTTP нема сенсу', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
      ])

      const result = beginOperation(operations, 'work-a', removeIntent)

      expect(result.started).toBe(false)
      expect(result.operations).toBe(operations)
    })

    it('committed з ІНШИМ kind (inverse) — дозволено, previous запам’ятовує committed-стан', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(addIntent(itemA))],
      ])

      const result = beginOperation(operations, 'work-a', removeIntent)

      expect(result.started).toBe(true)
      expect(result.operations.get('work-a')).toEqual(
        pending(removeIntent, committed(addIntent(itemA))),
      )
    })
  })

  describe('withCommittedOperation', () => {
    it('переводить pending → committed, intent зберігається', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(addIntent(itemA))],
      ])

      const next = withCommittedOperation(operations, 'work-a')

      expect(next.get('work-a')).toEqual(committed(addIntent(itemA)))
    })

    it('відсутній workId — та сама мапа назад', () => {
      const operations: WishlistOperations = new Map()

      expect(withCommittedOperation(operations, 'work-a')).toBe(operations)
    })

    it('вже committed — та сама мапа назад', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
      ])

      expect(withCommittedOperation(operations, 'work-a')).toBe(operations)
    })
  })

  describe('withRolledBackOperation', () => {
    it('pending без previous → запис прибирається повністю', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent)],
      ])

      expect(withRolledBackOperation(operations, 'work-a').has('work-a')).toBe(false)
    })

    it('pending inverse (з previous) → повертається ПОПЕРЕДНІЙ committed, а не голий стан', () => {
      // committed add(A) → користувач передумав → pending remove(A) → remove падає.
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent, committed(addIntent(itemA)))],
      ])

      const next = withRolledBackOperation(operations, 'work-a')

      expect(next.get('work-a')).toEqual(committed(addIntent(itemA)))
    })

    it('committed (не pending) — rollback не чіпає, та сама мапа', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
      ])

      expect(withRolledBackOperation(operations, 'work-a')).toBe(operations)
    })

    it('відсутній workId — та сама мапа назад', () => {
      const operations: WishlistOperations = new Map()

      expect(withRolledBackOperation(operations, 'work-a')).toBe(operations)
    })
  })

  describe('applyOperations', () => {
    it('remove A + remove B, обидві pending — прибирає обидва незалежно від порядку', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent)],
        ['work-b', pending(removeIntent)],
      ])

      expect(applyOperations([itemA, itemB], operations)).toEqual([])
    })

    it('add A + remove B — незалежні результати одночасно', () => {
      const optimisticA = optimisticWishlistItem(work, authors)
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-1', pending(addIntent(optimisticA))],
        ['work-b', pending(removeIntent)],
      ])

      expect(applyOperations([itemB], operations)).toEqual([optimisticA])
    })

    it('порядок вставки операцій не впливає на фінальний список', () => {
      const forward: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent)],
        ['work-b', pending(addIntent(itemB))],
      ])
      const backward: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-b', pending(addIntent(itemB))],
        ['work-a', pending(removeIntent)],
      ])

      expect(applyOperations([itemA], forward)).toEqual(applyOperations([itemA], backward))
    })

    it('лишає рядок committed-операції, поки reconciliation її не забрала (провалений confirmation reload)', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
      ])

      // Провалений фоновий reload не оновив lastData — сервер тут і досі
      // «бачить» work-a. Операція має лишитися накладеною, інакше видалений
      // рядок воскресає локально.
      expect(applyOperations([itemA, itemB], operations)).toEqual([itemB])
    })

    it('pending inverse над committed показує намір pending, а не previous', () => {
      // committed add(A) → pending remove(A): бачити мають ВІДСУТНЄ A, не A.
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent, committed(addIntent(itemA)))],
      ])

      expect(applyOperations([itemA], operations)).toEqual([])
    })
  })

  describe('reconcileOperations', () => {
    it('прибирає committed remove, чий ефект новий знімок сервера вже показує', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
      ])

      expect(reconcileOperations(operations, [itemB]).has('work-a')).toBe(false)
    })

    it('прибирає committed add, чий ефект новий знімок сервера вже показує', () => {
      const optimisticA = optimisticWishlistItem(work, authors)
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-1', committed(addIntent(optimisticA))],
      ])

      expect(reconcileOperations(operations, [item()]).has('work-1')).toBe(false)
    })

    it('НЕ прибирає pending — старий/фоновий GET не має права затирати активну операцію', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent)],
      ])

      // work-a вже відсутній у цьому знімку (наприклад, випадковий збіг чи
      // застарілий GET), але операція ще не committed — mutation власне ще не
      // відповіла, і чіпати журнал зарано.
      const next = reconcileOperations(operations, [itemB])

      expect(next.get('work-a')).toEqual(pending(removeIntent))
    })

    it('НЕ прибирає pending inverse над committed — стара committed-версія вже не існує в журналі', () => {
      // Застарілий reload від УЖЕ ЗАМІНЕНОЇ committed add(A) не повинен
      // чіпати нову pending remove(A): work-a відсутній у знімку — це b
      // "reflects" remove, але operation тут pending, тож reconcile мовчить.
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent, committed(addIntent(itemA)))],
      ])

      const next = reconcileOperations(operations, [])

      expect(next.get('work-a')?.status).toBe('pending')
    })

    it('committed, але ефект іще не видно на сервері — лишається', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
      ])

      const next = reconcileOperations(operations, [itemA, itemB])

      expect(next.get('work-a')).toEqual(committed(removeIntent))
    })

    it('нічого не змінилося — та сама мапа назад', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', pending(removeIntent)],
      ])

      expect(reconcileOperations(operations, [itemA, itemB])).toBe(operations)
    })

    it('одна committed прибирається, сусідня pending лишається — незалежно одна від одної', () => {
      const operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
        ['work-b', pending(removeIntent)],
      ])

      const next = reconcileOperations(operations, [itemB])

      expect(next.has('work-a')).toBe(false)
      expect(next.get('work-b')).toEqual(pending(removeIntent))
    })

    it('послідовні reconcile проти дедалі повніших знімків не лишають жодного зайвого запису', () => {
      // Дві committed-операції; кожен наступний виклик — свіжіший, дедалі
      // повніший знімок сервера (як послідовні успішні reload). Жодна не
      // повинна пережити свій власний підтверджений знімок.
      let operations: WishlistOperations = new Map<string, WishlistOperation>([
        ['work-a', committed(removeIntent)],
        ['work-b', committed({ kind: 'add', item: itemB })],
      ])

      // Перший знімок підтверджує лише work-a (work-b на сервері ще нема).
      operations = reconcileOperations(operations, [])
      expect(operations.has('work-a')).toBe(false)
      expect(operations.has('work-b')).toBe(true)

      // Другий, свіжіший знімок нарешті підтверджує й work-b.
      operations = reconcileOperations(operations, [itemB])
      expect(operations.size).toBe(0)
    })
  })
})
