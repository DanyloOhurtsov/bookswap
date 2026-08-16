import type {
  BorrowedCopy,
  Edition,
  LibraryCounts,
  OwnCopy,
  VisibleCopy,
  Work,
  WorkAuthor,
} from '@bookswap/shared'
import {
  byEditionOrder,
  toEdition,
  toWork,
  toWorkAuthors,
  type EditionRow,
  type WorkAuthorRow,
  type WorkRow,
} from '../catalog/catalog.mapper'
import { toPublicUser } from '../users/user.mapper'
import type { CopyModel, UserModel } from '../generated/prisma/models'

/**
 * Чисті проєкції та групування бібліотеки. Ні Prisma-клієнта, ні Nest — тому
 * §9 у частині «що саме віддається» перевіряється unit-тестом без PostgreSQL.
 *
 * Проєкцій три, і це не дублювання: власник, гість і той, у кого чужа книжка, —
 * різні ролі з різними правами. §9 вимагає, щоб приватне **не віддавалося з
 * API**, а не ховалося в UI, і єдиний надійний спосіб це гарантувати — щоб
 * приватного поля не існувало у відповідній функції взагалі. Одна проєкція з
 * прапорцями рано чи пізно віддала б нотатку не тому, кому слід.
 */

export type UserRow = Pick<UserModel, 'id' | 'displayName' | 'avatarUrl'>

export type CopyRow = Pick<
  CopyModel,
  | 'id'
  | 'ownerId'
  | 'currentHolderId'
  | 'status'
  | 'visibility'
  | 'condition'
  | 'note'
  | 'acquiredAt'
  | 'createdAt'
> & {
  edition: EditionRow & { work: WorkRow & { authors: WorkAuthorRow[] } }
  owner: UserRow
  currentHolder: UserRow
}

export interface LibraryGroupOf<TCopy> {
  edition: Edition
  work: Work
  authors: WorkAuthor[]
  copies: TCopy[]
  counts: LibraryCounts
}

/** Інваріант §5.3.2 в термінах інтерфейсу: «вдома» = тримач і є власником. */
export function isHome(copy: Pick<CopyRow, 'ownerId' | 'currentHolderId'>): boolean {
  return copy.ownerId === copy.currentHolderId
}

/** Дата придбання без часу: «о котрій годині ви купили книжку» не означає нічого. */
function toIsoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10)
}

export function toOwnCopy(copy: CopyRow): OwnCopy {
  const home = isHome(copy)

  return {
    id: copy.id,
    status: copy.status,
    visibility: copy.visibility,
    condition: copy.condition,
    note: copy.note,
    acquiredAt: toIsoDate(copy.acquiredAt),
    createdAt: copy.createdAt.toISOString(),
    isHome: home,
    // Власник бачить імена завжди (§6.6) — його власний прапорець
    // `showHolderNames` керує тим, що бачать інші, а не він сам.
    holder: home ? null : toPublicUser(copy.currentHolder),
  }
}

/**
 * `showHolderName` вирішує не ця функція, а `holderNamesVisibleTo` зі §9 — сюди
 * приїжджає вже готова відповідь. Інакше правило видимості імен існувало б у
 * двох місцях і розійшлося б.
 */
export function toVisibleCopy(copy: CopyRow, showHolderName: boolean): VisibleCopy {
  const home = isHome(copy)

  return {
    id: copy.id,
    status: copy.status,
    condition: copy.condition,
    isHome: home,
    holder: home || !showHolderName ? null : toPublicUser(copy.currentHolder),
  }
}

export function toBorrowedCopy(copy: CopyRow): BorrowedCopy {
  return {
    id: copy.id,
    status: copy.status,
    condition: copy.condition,
    owner: toPublicUser(copy.owner),
  }
}

/**
 * §6.4: «Шантарам ×3 · 2 вдома, 1 у Марка».
 *
 * Групування — подання, а не модель: окремі `Copy` лишаються поштучно в
 * `copies`, бо кількість примірників — це `COUNT` рядків, а не поле `quantity`
 * (§3). Проєкція елемента передається зовні, тож та сама логіка групування
 * обслуговує всі три ролі, не знаючи про жодну з них.
 */
export function groupByEdition<TCopy>(
  copies: CopyRow[],
  project: (copy: CopyRow) => TCopy,
): LibraryGroupOf<TCopy>[] {
  const groups = new Map<string, CopyRow[]>()

  for (const copy of copies) {
    const existing = groups.get(copy.edition.id)

    if (existing === undefined) groups.set(copy.edition.id, [copy])
    else existing.push(copy)
  }

  return [...groups.values()]
    .flatMap((rows) => {
      const [first] = rows

      if (first === undefined) return []

      const ordered = [...rows].sort(
        (one, other) =>
          one.createdAt.getTime() - other.createdAt.getTime() || one.id.localeCompare(other.id),
      )
      const home = ordered.filter(isHome).length

      return [
        {
          edition: toEdition(first.edition, first.edition.work),
          work: toWork(first.edition.work),
          authors: toWorkAuthors(first.edition.work.authors),
          copies: ordered.map(project),
          counts: { total: ordered.length, home, out: ordered.length - home },
        },
      ]
    })
    .sort(
      (one, other) =>
        one.work.title.localeCompare(other.work.title, 'uk') ||
        byEditionOrder(one.edition, other.edition),
    )
}
