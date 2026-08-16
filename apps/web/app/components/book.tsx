'use client'

import Link from 'next/link'
import type { Edition, Work, WorkAuthor } from '@bookswap/shared'
import { AUTHOR_ROLE_LABELS, EDITION_FORMAT_LABELS } from '../lib/labels'

/**
 * Спільні шматки показу каталогу: підпис авторів, рядок видання, чипи ознак.
 *
 * Винесені сюди, бо однакові на чотирьох сторінках — пошуку, творі, бібліотеці
 * своїй і чужій. Розійшовшись, вони б показували ту саму книжку по-різному.
 */

export function AuthorLine({ authors }: { authors: WorkAuthor[] }) {
  if (authors.length === 0) return <span className="book__meta">Автора не вказано</span>

  return (
    <span className="book__meta">
      {authors
        .map((author) =>
          author.role === 'AUTHOR'
            ? author.name
            : `${author.name} (${AUTHOR_ROLE_LABELS[author.role]})`,
        )
        .join(', ')}
    </span>
  )
}

export function WorkTitle({ work, authors }: { work: Work; authors: WorkAuthor[] }) {
  return (
    <>
      <Link className="book__title" href={`/works/${work.id}`}>
        {work.title}
      </Link>
      <AuthorLine authors={authors} />
      {work.firstPubYear !== null && (
        <span className="book__meta">Уперше видано {work.firstPubYear}</span>
      )}
    </>
  )
}

/**
 * Рядок видання. `lang` і `translator` рахує сервер — для видання мовою
 * оригіналу це мова твору й порожній перекладач (§4.4), і фронт цю умову не
 * повторює.
 */
export function EditionLine({ edition }: { edition: Edition }) {
  const parts = [
    edition.publisher,
    edition.year === null ? null : String(edition.year),
    edition.lang,
    EDITION_FORMAT_LABELS[edition.format],
    edition.pageCount === null ? null : `${String(edition.pageCount)} с.`,
  ].filter((part): part is string => part !== null && part !== '')

  return (
    <span className="book__meta">
      {parts.join(' · ')}
      {edition.translator !== null && (
        <>
          {' · '}
          переклад: {edition.translator}
        </>
      )}
      {edition.isbn13 !== null && <> · ISBN {edition.isbn13}</>}
    </span>
  )
}

export function Chip({ children }: { children: string }) {
  return <span className="chip">{children}</span>
}
