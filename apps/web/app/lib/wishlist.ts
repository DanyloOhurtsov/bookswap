import type { Work, WishlistItem, WorkAuthor } from '@bookswap/shared'

/**
 * Чиста логіка оптимістичного оновлення вішлиста (Етап 7f, DoD: «оптимістичне
 * оновлення відкочується при помилці»; конкурентний прохід додав журнал
 * операцій за workId, а прохід над inverse-діями — `previous` нижче).
 *
 * Винесено з `use-wishlist.ts` так само, як `notification-preferences.ts` —
 * `apps/web` тестує лише `.ts` у `app/lib`, і саме тут живе правило, яке варте
 * перевірки без React: що саме показати в списку одразу після кліку, до
 * відповіді сервера.
 */

export function isInWishlist(items: readonly WishlistItem[], workId: string): boolean {
  return items.some((item) => item.workId === workId)
}

/** Дублікат не додається вдруге — той самий інваріант, що й `(userId, workId)` на сервері. */
export function withAdded(items: readonly WishlistItem[], item: WishlistItem): WishlistItem[] {
  if (isInWishlist(items, item.workId)) return [...items]

  return [item, ...items]
}

export function withRemoved(items: readonly WishlistItem[], workId: string): WishlistItem[] {
  return items.filter((item) => item.workId !== workId)
}

/**
 * Пункт списку до підтвердження сервером. `id` із префіксом `optimistic:` —
 * не справжній рядок бази, лише ключ для React-списку; членство в цей момент
 * рахується за `workId`, а справжній `id` приїжджає з наступним `reload()`.
 */
export function optimisticWishlistItem(work: Work, authors: WorkAuthor[]): WishlistItem {
  return {
    id: `optimistic:${work.id}`,
    workId: work.id,
    work,
    authors,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Журнал операцій за workId — заміна єдиного `overlay: WishlistItem[]` і
 * `before`-знімку для відкату.
 *
 * Паралельні `remove(A)` і `remove(B)` раніше ділили ОДИН знімок масиву: коли
 * `A` падав, відкат повертав масив, знятий ДО того, як `B` взагалі стартував,
 * і щойно видалений `B` воскресав локально. Ключування за workId прибирає цю
 * колізію структурно — в кожної операції своя адреса в мапі, і відкат чи
 * підтвердження однієї ніяк не торкається сусідньої.
 *
 * Кожен запис — або `pending` (власний HTTP ще летить), або `committed`
 * (HTTP відповів успіхом, чекаємо лише знімок сервера — `reconcileOperations`
 * нижче). `pending` додатково несе `previous`: committed-операцію, яку слід
 * повернути, якщо ЦЯ mutation провалиться. Це потрібно для inverse-дій:
 * committed add(A) → користувач передумав → pending remove(A). Якщо remove
 * падає, звичайне «просто прибрати запис» показало б голий серверний знімок
 * без A — хоча add уже пройшов і сервер це підтвердив. `previous` дає
 * відновити САМЕ committed add(A), а не втратити його.
 */
export type WishlistOperationKind = 'add' | 'remove'

interface WishlistAddIntent {
  readonly kind: 'add'
  readonly item: WishlistItem
}

interface WishlistRemoveIntent {
  readonly kind: 'remove'
}

/** Що саме робить операція — без статусу; статус живе в обгортці нижче. */
export type WishlistOperationIntent = WishlistAddIntent | WishlistRemoveIntent

export interface WishlistCommittedOperation {
  readonly status: 'committed'
  readonly intent: WishlistOperationIntent
}

export interface WishlistPendingOperation {
  readonly status: 'pending'
  readonly intent: WishlistOperationIntent
  /** `undefined`, коли до цієї mutation журнал для цього workId був порожній. */
  readonly previous: WishlistCommittedOperation | undefined
}

export type WishlistOperation = WishlistPendingOperation | WishlistCommittedOperation

export type WishlistOperations = ReadonlyMap<string, WishlistOperation>

export interface BeginOperationResult {
  readonly operations: WishlistOperations
  readonly started: boolean
}

/**
 * Заводить нову pending-операцію під `workId` — або відмовляє, не займаючи
 * журнал:
 *
 * - вже є `pending` (свій чи inverse) — відмова: «поки нова mutation pending,
 *   інші виклики того самого workId блокуються», і саме тут, а не десь
 *   пізніше, ловиться подвійний клік до того самого workId в один тік.
 * - вже `committed` із ТИМ САМИМ `kind` — відмова: дія вже досягнута, дублю
 *   вати HTTP нема сенсу.
 * - `committed` із ІНШИМ `kind` (inverse) — дозволено; `previous` запам'ятовує
 *   поточний committed-стан, щоб було що повернути при провалі.
 * - нічого нема — дозволено; `previous` — `undefined`.
 */
export function beginOperation(
  operations: WishlistOperations,
  workId: string,
  intent: WishlistOperationIntent,
): BeginOperationResult {
  const existing = operations.get(workId)

  if (existing?.status === 'pending') return { operations, started: false }
  if (existing?.status === 'committed' && existing.intent.kind === intent.kind) {
    return { operations, started: false }
  }

  const next = new Map(operations)

  next.set(workId, { status: 'pending', intent, previous: existing })

  return { operations: next, started: true }
}

/**
 * `pending` → `committed`: власний HTTP відповів успіхом. Операція лишається
 * накладеною на список — прибере її лише `reconcileOperations`, коли сервер
 * підтвердить її свіжим знімком, а не сам факт успішної відповіді мутації.
 * Саме тут ламався оригінальний код: `await reload(); setOverlay(undefined)`
 * знімав оверлей БЕЗУМОВНО, навіть якщо `reload()` відповів помилкою.
 */
export function withCommittedOperation(
  operations: WishlistOperations,
  workId: string,
): WishlistOperations {
  const operation = operations.get(workId)

  if (operation === undefined || operation.status !== 'pending') return operations

  return new Map(operations).set(workId, { status: 'committed', intent: operation.intent })
}

/**
 * `pending` → `previous` (якщо була) або порожньо. НЕ звичайне видалення
 * запису: якщо ця pending-операція сама була inverse-дією над committed
 * mutation, що вже пройшла (committed add(A) → pending remove(A), і remove
 * падає), провал повертає ЩОЙНО committed add(A) назад, а не оголює запис.
 */
export function withRolledBackOperation(
  operations: WishlistOperations,
  workId: string,
): WishlistOperations {
  const operation = operations.get(workId)

  if (operation === undefined || operation.status !== 'pending') return operations

  const next = new Map(operations)

  if (operation.previous === undefined) next.delete(workId)
  else next.set(workId, operation.previous)

  return next
}

function isReflectedByServer(
  operation: WishlistCommittedOperation,
  workId: string,
  serverItems: readonly WishlistItem[],
): boolean {
  const present = isInWishlist(serverItems, workId)

  return operation.intent.kind === 'add' ? present : !present
}

/**
 * Прибирає ЛИШЕ `committed`-операції, чий ефект новий знімок сервера вже
 * показує; `pending` не займає — операція, чий власний HTTP іще не завершився,
 * мусить пережити будь-який сторонній чи застарілий фоновий GET (інакше
 * оптимістичний стан губиться раніше, ніж прийшла відповідь на власну дію).
 * Це саме правило захищає й inverse-сценарій: щойно committed add(A) заміню
 * ється на pending remove(A), стара committed-версія більше не існує в
 * журналі — застарілий reload, спричинений ЩЕ ТОЮ mutation, застає тут
 * тільки `pending` і проходить повз.
 *
 * Байдуже, ЯКИЙ саме reload() приніс цей знімок: перевірка за вмістом, а не
 * за тим, чий саме виклик це був, — тому й невдалий confirmation reload після
 * успішної mutation не біда (операція просто чекає наступного вдалого), і
 * наступний вдалий reload, спричинений геть іншою дією, однаково узгоджує.
 */
export function reconcileOperations(
  operations: WishlistOperations,
  serverItems: readonly WishlistItem[],
): WishlistOperations {
  let next: Map<string, WishlistOperation> | undefined

  for (const [workId, operation] of operations) {
    if (operation.status === 'committed' && isReflectedByServer(operation, workId, serverItems)) {
      next ??= new Map(operations)
      next.delete(workId)
    }
  }

  return next ?? operations
}

/**
 * Найновіший знімок сервера + журнал операцій → видимий список. Статус
 * (`pending`/`committed`) не впливає на застосування — обидва накладаються
 * однаково, різниця лише в тому, коли й чим саме операцію можна прибрати чи
 * відкотити. Порядок операцій одна на одну не важливий: кожна торкається
 * лише свого workId, а `withAdded`/`withRemoved` уже ідемпотентні самі по
 * собі.
 */
export function applyOperations(
  serverItems: readonly WishlistItem[],
  operations: WishlistOperations,
): WishlistItem[] {
  let items: WishlistItem[] = [...serverItems]

  for (const [workId, operation] of operations) {
    items =
      operation.intent.kind === 'add'
        ? withAdded(items, operation.intent.item)
        : withRemoved(items, workId)
  }

  return items
}
