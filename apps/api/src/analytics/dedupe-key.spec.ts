import { computeDedupeKey } from './dedupe-key'

describe('computeDedupeKey (§2.2)', () => {
  it('детермінована на однакових вхідних', () => {
    const first = computeDedupeKey('BOOK_ADDED', 'copy-1', 'user-1')
    const second = computeDedupeKey('BOOK_ADDED', 'copy-1', 'user-1')

    expect(first).toBe(second)
  })

  it('різний eventType дає різний ключ', () => {
    expect(computeDedupeKey('LOAN_REQUESTED', 'loan-1', 'user-1')).not.toBe(
      computeDedupeKey('LOAN_APPROVED', 'loan-1', 'user-1'),
    )
  })

  it('різний domainEntityId дає різний ключ', () => {
    expect(computeDedupeKey('BOOK_ADDED', 'copy-1', 'user-1')).not.toBe(
      computeDedupeKey('BOOK_ADDED', 'copy-2', 'user-1'),
    )
  })

  it('різний subjectUserId дає різний ключ', () => {
    expect(computeDedupeKey('BOOK_ADDED', 'copy-1', 'user-1')).not.toBe(
      computeDedupeKey('BOOK_ADDED', 'copy-1', 'user-2'),
    )
  })

  /**
   * §4/§5: FRIEND_ACCEPTED пишеться двічі для тієї самої friendship — один
   * subjectUserId на подію. Ключі мусять розрізнятися, інакше друга подія
   * стала б no-op дублікатом першої.
   */
  it('дві події FRIEND_ACCEPTED для однієї friendship і різних subjectUserId мають різні ключі', () => {
    const forUserA = computeDedupeKey('FRIEND_ACCEPTED', 'friendship-1', 'user-a')
    const forUserB = computeDedupeKey('FRIEND_ACCEPTED', 'friendship-1', 'user-b')

    expect(forUserA).not.toBe(forUserB)
  })

  it('маркер "-" для подій без суб\'єкта дає такий самий детермінований ключ', () => {
    const first = computeDedupeKey('LOAN_REQUESTED', 'loan-1', '-')
    const second = computeDedupeKey('LOAN_REQUESTED', 'loan-1', '-')

    expect(first).toBe(second)
    expect(first).not.toBe(computeDedupeKey('LOAN_REQUESTED', 'loan-1', 'user-1'))
  })

  it('результат — SHA-256 hex (64 hex-символи)', () => {
    const key = computeDedupeKey('SIGNUP_COMPLETED', 'user-1', 'user-1')

    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
