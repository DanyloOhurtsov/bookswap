import { z } from 'zod'

/**
 * ISBN-13 із перевіркою контрольної суми (§11).
 *
 * Без суми перевірка формату майже нічого не ловить: тринадцять довільних цифр
 * пройдуть, а `Edition.isbn13` — унікальний ключ (§4.4). Одна помилкова цифра в
 * ньому не просто псує запис, а назавжди займає чужий номер, бо редагування
 * метаданих у v1 немає (§6.3).
 */

/** Дефіси й пробіли — суто друкарське оформлення: «978-617-12-1234-5» = «9786171212345». */
export function normalizeIsbn13(value: string): string {
  return value.replace(/[\s-]/g, '')
}

/**
 * Контрольна сума ISBN-13: цифри з вагами 1 і 3 по черзі, сума кратна 10.
 *
 * Перевіряється й префікс: ISBN-13 — це EAN-13 із діапазону Bookland, тобто
 * завжди 978 або 979. Без цієї умови будь-який штрихкод із пляшки мінералки
 * пройшов би як коректний ISBN, бо алгоритм суми в EAN-13 той самий.
 */
export function isValidIsbn13(value: string): boolean {
  const digits = normalizeIsbn13(value)

  if (!/^\d{13}$/.test(digits)) return false
  if (!digits.startsWith('978') && !digits.startsWith('979')) return false

  let sum = 0

  for (const [index, character] of [...digits].entries()) {
    sum += Number(character) * (index % 2 === 0 ? 1 : 3)
  }

  return sum % 10 === 0
}

/** Нормалізація до перевірки, як і в `emailSchema`: у базу лягають самі цифри. */
export const isbn13Schema = z
  .string()
  .trim()
  .transform(normalizeIsbn13)
  .refine(isValidIsbn13, 'Некоректний ISBN-13: не сходиться контрольна сума')
