/**
 * Чистий, тестовий генератор ISBN — навмисно без жодного імпорту, що тягне
 * `AppModule`/Nest testing/Prisma/`ConfigModule` (і, з ним, env validation
 * при старті процесу).
 *
 * Раніше жив у `auth.helpers.ts`, який імпортує `AppModule` для
 * `createTestApp()`. `unique-isbn.spec.ts` — unit-специфікація (запускається
 * `apps/api/jest.config.js`, без `DATABASE_URL`/`DIRECT_DATABASE_URL`), і
 * імпорт `uniqueIsbn13` звідти транзитивно тягнув за собою `AppModule` →
 * `ConfigModule.forRoot({ validate: validateEnv })` → падіння Jest worker'а
 * ще до першого тесту. Файл нижче — межа, яка більше не пускає env
 * validation в unit-прогін: сюди дозволені лише чисті типи/helpers і
 * `@bookswap/shared` (сам по собі без side effects при імпорті).
 */

const isbnCounters = new Map<string, number>()

/**
 * FNV-1a, 32-біт. Детермінований (не `Math.random`, не timestamp) хеш рядка
 * `namespace` у стабільну область — саме тому колізія між двома конкретними
 * namespace або є, або її немає назавжди, і це можна довести раз тестом, а не
 * сподіватись на ймовірність при кожному прогоні.
 */
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/**
 * Валідний ISBN-13 (§11: Bookland-префікс 978/979 + контрольна сума EAN-13),
 * унікальний на кожен виклик у межах namespace. Між e2e-файлами гарантія діє
 * для набору namespace, який явно перевіряє `unique-isbn.spec.ts`.
 *
 * Namespace замінює стару process-global формулу з `process.pid`, яка
 * повторювала ISBN між ізольованими Jest spec-файлами. Його хеш дає
 * 6-цифрову область, а 3-цифровий лічильник — до 999 ISBN за прогін.
 * Довільні namespace теоретично можуть мати однаковий хеш-регіон, тому кожен
 * реальний caller треба додавати до перевіреного списку в
 * `unique-isbn.spec.ts`; поточні п'ять не колізять.
 */
export function uniqueIsbn13(namespace: string, bookland: '978' | '979' = '978'): string {
  const next = (isbnCounters.get(namespace) ?? 0) + 1

  if (next > 999) {
    throw new Error(`uniqueIsbn13: вичерпано лічильник (999) для namespace "${namespace}"`)
  }

  isbnCounters.set(namespace, next)

  const region = String(fnv1a32(namespace) % 1_000_000).padStart(6, '0')
  const body = `${bookland}${region}${String(next).padStart(3, '0')}`

  let sum = 0

  for (const [index, character] of [...body].entries()) {
    sum += Number(character) * (index % 2 === 0 ? 1 : 3)
  }

  return `${body}${String((10 - (sum % 10)) % 10)}`
}
