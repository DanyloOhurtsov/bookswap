/**
 * Ідентичність запиту й правило «що показувати» — без React.
 *
 * Винесено окремо навмисно: саме тут жив дефект, який неможливо побачити в
 * типах. Ключ запиту складався як `nonce + path` і тому **повторювався** —
 * повернення на вже завантажений шлях давало ключ, який уже колись існував, і
 * хук віддавав стару відповідь як `ready`, поки новий GET іще летів.
 *
 * Функції нижче чисті, тож правило перевіряється звичайним `pnpm test`, без
 * jsdom і без бібліотек рендерингу.
 */

export type ResourceState<TData> =
  { status: 'loading' } | { status: 'ready'; data: TData } | { status: 'error'; message: string }

/** Слід, який лишило по собі конкретне покоління запиту. */
export interface ResourceSnapshot<TData> {
  /** Що саме запитувалося: лічильник `reload`, схема й шлях. */
  key: string
  /** Монотонний номер покоління ефекту, яке цей слід записало. */
  generation: number
  state: ResourceState<TData>
}

/**
 * Стабільний номер для обʼєкта-схеми.
 *
 * Схема — частина того, «що саме запитано»: той самий шлях із іншою схемою це
 * інший запит (наприклад `/me/library/borrowed` розбирається іншим контрактом).
 * Порівняти схеми змістовно неможливо, зате в них є ідентичність, і `WeakMap`
 * перетворює її на число, не заважаючи збирачу сміття.
 *
 * Виклик ідемпотентний: той самий обʼєкт завжди дає той самий номер, тож
 * повторний рендер нічого не змінює.
 */
const schemaIds = new WeakMap<object, number>()

let lastSchemaId = 0

export function schemaIdOf(schema: object): number {
  const known = schemaIds.get(schema)

  if (known !== undefined) return known

  lastSchemaId += 1
  schemaIds.set(schema, lastSchemaId)

  return lastSchemaId
}

/**
 * Ідентичність **входів** запиту.
 *
 * Схема входить у ключ разом зі шляхом: без неї зміна схеми на тому самому
 * шляху лишала ключ незмінним, і один рендер устигав показати стару відповідь
 * як свіжу.
 */
export function requestKey(nonce: number, schema: object, path: string): string {
  return `${String(nonce)} ${String(schemaIdOf(schema))} ${path}`
}

/**
 * Що показувати просто зараз.
 *
 * Дві умови, і жодна не зайва:
 *
 * 1. **Ключ.** Входи щойно змінилися, а ефект ще не встиг запуститися — слід від
 *    попереднього запиту стосується вже не того, що на екрані.
 * 2. **Покоління.** Ключ збігся, але це збіг **входів**, а не запитів: сценарій
 *    A → B → A дає для другого A той самий ключ, що й для першого. Без цієї
 *    умови хук віддав би дані першого A, поки другий іще летить, — і кнопки дій
 *    стали б активними на застарілій картці.
 *
 * Порівнюється саме «останнє **запущене** покоління», а не завершене: доки
 * поточний запит не дійшов до кінця, правильна відповідь — `loading`.
 */
export function visibleState<TData>(
  snapshot: ResourceSnapshot<TData> | null,
  key: string,
  generation: number,
): ResourceState<TData> {
  if (snapshot === null) return { status: 'loading' }
  if (snapshot.key !== key) return { status: 'loading' }
  if (snapshot.generation !== generation) return { status: 'loading' }

  return snapshot.state
}
