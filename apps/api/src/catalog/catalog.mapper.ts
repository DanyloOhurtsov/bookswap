import type { AuthorRole, Edition, Translation, Work, WorkAuthor } from '@bookswap/shared'
import type {
  AuthorModel,
  EditionModel,
  TranslationModel,
  WorkModel,
} from '../generated/prisma/models'

/**
 * Чисті проєкції Prisma → контракт. Без Nest і без Prisma-клієнта: усе, що тут
 * є, — перекладання полів, тож воно покривається unit-тестом без PostgreSQL.
 *
 * Типи вхідних даних структурні (`Pick<>`), а не моделі цілком: мапер має
 * залежати від полів, які читає, а не від таблиці. Якщо в схемі зникне поле,
 * зламається саме тут, а не десь у рантаймі.
 */

export type WorkRow = Pick<
  WorkModel,
  'id' | 'title' | 'origLang' | 'firstPubYear' | 'description' | 'createdAt' | 'revision'
>

export interface WorkAuthorRow {
  role: AuthorRole
  /** Stage 8e-1, R10a: manual order — the sole ordering key, see `toWorkAuthors`. */
  position: number
  author: Pick<AuthorModel, 'id' | 'name' | 'nameLatin'>
}

export type TranslationRow = Pick<
  TranslationModel,
  | 'id'
  | 'workId'
  | 'translator'
  | 'lang'
  | 'sourceLang'
  | 'year'
  | 'isAbridged'
  | 'hasNotes'
  | 'notes'
  | 'revision'
>

export type EditionRow = Pick<
  EditionModel,
  | 'id'
  | 'workId'
  | 'translationId'
  | 'publisher'
  | 'year'
  | 'isbn13'
  | 'pageCount'
  | 'coverUrl'
  | 'format'
  | 'revision'
> & {
  translation: Pick<TranslationModel, 'lang' | 'translator'> | null
}

export function toWork(work: WorkRow): Work {
  return {
    id: work.id,
    title: work.title,
    origLang: work.origLang,
    firstPubYear: work.firstPubYear,
    description: work.description,
    createdAt: work.createdAt.toISOString(),
    revision: work.revision,
  }
}

/**
 * Stage 8e-1, R10a: `position` — єдине джерело порядку. Роль більше не задає
 * власне сортування (вона й раніше не була ідентичністю зв'язку, лише
 * первинним тай-брейком) — після backfill і create/merge, що призначають
 * `position` самі, читання його більше не пересортовує.
 */
export function toWorkAuthors(rows: WorkAuthorRow[]): WorkAuthor[] {
  return [...rows]
    .sort((one, other) => one.position - other.position)
    .map((row) => ({
      id: row.author.id,
      name: row.author.name,
      nameLatin: row.author.nameLatin,
      role: row.role,
      position: row.position,
    }))
}

export function toTranslation(translation: TranslationRow, editionCount: number): Translation {
  return {
    id: translation.id,
    workId: translation.workId,
    translator: translation.translator,
    lang: translation.lang,
    sourceLang: translation.sourceLang,
    year: translation.year,
    isAbridged: translation.isAbridged,
    hasNotes: translation.hasNotes,
    notes: translation.notes,
    editionCount,
    revision: translation.revision,
  }
}

/**
 * `lang` і `translator` — обчислені: `translationId = null` означає видання
 * мовою оригіналу (§4.4), тож мова береться з твору, а перекладача немає.
 *
 * Рахується один раз тут, а не на кожній сторінці, що показує видання: інакше
 * умова «якщо переклад є — беремо з нього» розповзеться по клієнту й одного дня
 * розійдеться сама з собою.
 */
export function toEdition(edition: EditionRow, work: Pick<WorkModel, 'origLang'>): Edition {
  return {
    id: edition.id,
    workId: edition.workId,
    translationId: edition.translationId,
    publisher: edition.publisher,
    year: edition.year,
    isbn13: edition.isbn13,
    pageCount: edition.pageCount,
    coverUrl: edition.coverUrl,
    format: edition.format,
    lang: edition.translation?.lang ?? work.origLang,
    translator: edition.translation?.translator ?? null,
    revision: edition.revision,
  }
}

/**
 * Новіше — вище: людина шукає своє видання очима, і рік звужує вибір швидше за
 * будь-що інше. Видання без року йдуть у кінець, а не на початок: невідомий рік
 * не робить книжку найновішою.
 */
export function byEditionOrder(one: Edition, other: Edition): number {
  if (one.year !== other.year) {
    if (one.year === null) return 1
    if (other.year === null) return -1

    return other.year - one.year
  }

  return (
    (one.publisher ?? '').localeCompare(other.publisher ?? '', 'uk') ||
    one.id.localeCompare(other.id)
  )
}
