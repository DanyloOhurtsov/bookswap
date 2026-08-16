import { isValidIsbn13, isbn13Schema, normalizeIsbn13 } from './isbn'

describe('normalizeIsbn13', () => {
  it('знімає дефіси й пробіли — це оформлення, а не частина номера', () => {
    expect(normalizeIsbn13('978-3-16-148410-0')).toBe('9783161484100')
    expect(normalizeIsbn13(' 978 3 16 148410 0 ')).toBe('9783161484100')
  })
})

describe('isValidIsbn13', () => {
  it.each([
    '9783161484100',
    '978-3-16-148410-0',
    '9780306406157',
    '9786171212343',
    '9798600000001',
  ])('приймає %s', (value) => {
    expect(isValidIsbn13(value)).toBe(true)
  })

  it('відхиляє номер із поламаною контрольною сумою', () => {
    // Та сама книжка, остання цифра змінена на сусідню.
    expect(isValidIsbn13('9780306406156')).toBe(false)
    expect(isValidIsbn13('9783161484101')).toBe(false)
  })

  it('ловить перестановку сусідніх цифр — те, заради чого сума й існує', () => {
    expect(isValidIsbn13('9783161484100')).toBe(true)
    expect(isValidIsbn13('9783161481400')).toBe(false)
  })

  it('відхиляє не 13 цифр', () => {
    expect(isValidIsbn13('978316148410')).toBe(false)
    expect(isValidIsbn13('97831614841000')).toBe(false)
    expect(isValidIsbn13('')).toBe(false)
  })

  it('відхиляє літери', () => {
    expect(isValidIsbn13('97831614841OO')).toBe(false)
  })

  it('відхиляє коректний EAN-13 поза діапазоном Bookland', () => {
    // Сума сходиться, але 482… — це не книжка: алгоритм суми в EAN-13 той самий.
    expect(isValidIsbn13('4820000000000')).toBe(false)
  })
})

describe('isbn13Schema', () => {
  it('нормалізує до перевірки й віддає самі цифри', () => {
    expect(isbn13Schema.parse('978-3-16-148410-0')).toBe('9783161484100')
  })

  it('відхиляє номер із хибною сумою', () => {
    expect(isbn13Schema.safeParse('978-3-16-148410-1').success).toBe(false)
  })
})
