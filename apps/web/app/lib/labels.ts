import type { AuthorRole, Condition, CopyStatus, EditionFormat, Visibility } from '@bookswap/shared'

/**
 * Людські підписи до доменних enum'ів.
 *
 * Живуть у `apps/web`, а не в `packages/shared`: контракт описує **значення**, а
 * як їх називати людині — справа інтерфейсу. §15.5 лишає питання мови UI
 * відкритим, і тримати переклади в спільному пакеті означало б відповісти на
 * нього за всіх.
 */

export const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = {
  PUBLIC: 'Публічно — бачить будь-хто',
  FRIENDS: 'Для друзів',
  PRIVATE: 'Приватно — тільки я',
}

export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  NEW: 'Як нова',
  GOOD: 'Добрий стан',
  WORN: 'Потерта',
  DAMAGED: 'Пошкоджена',
}

export const COPY_STATUS_LABELS: Readonly<Record<CopyStatus, string>> = {
  AVAILABLE: 'Вдома, вільна',
  RESERVED: 'Домовлено про передачу',
  LENT_OUT: 'У позичальника',
  UNAVAILABLE: 'Тимчасово не даю',
}

export const EDITION_FORMAT_LABELS: Readonly<Record<EditionFormat, string>> = {
  HARDCOVER: 'тверда',
  PAPERBACK: 'мʼяка',
  POCKET: 'кишенькова',
}

export const AUTHOR_ROLE_LABELS: Readonly<Record<AuthorRole, string>> = {
  AUTHOR: 'автор',
  CO_AUTHOR: 'співавтор',
  EDITOR: 'редактор',
  ILLUSTRATOR: 'ілюстратор',
}

/**
 * Підказки для поля мови — не заміна валідації.
 *
 * Це `datalist`, а не `select`: ISO 639-1 має 184 коди, і випадаючий список із
 * них нечитабельний, а обрізаний до десятка зробив би книжку баскською мовою
 * недодаваною. Тут — те, що трапляється на домашній полиці; ввести можна
 * будь-який валідний код, і перевірить його спільна схема.
 */
export const LANGUAGE_HINTS: readonly { code: string; label: string }[] = [
  { code: 'uk', label: 'українська' },
  { code: 'en', label: 'англійська' },
  { code: 'pl', label: 'польська' },
  { code: 'de', label: 'німецька' },
  { code: 'fr', label: 'французька' },
  { code: 'es', label: 'іспанська' },
  { code: 'it', label: 'італійська' },
  { code: 'cs', label: 'чеська' },
  { code: 'ja', label: 'японська' },
  { code: 'la', label: 'латина' },
]

/** ISO-дата з API → коротка людська дата. Локаль явна: сервер і клієнт мусять збігтися. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
