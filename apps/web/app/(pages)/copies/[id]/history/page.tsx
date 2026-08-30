'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AuthorLine, EditionLine } from '@/components/BookParts'
import { useCopyHistory } from '@/app/lib/use-history'
import { assertNever } from '@/app/lib/assert-never'
import { FormStatus } from '@/components/Form/FormStatus'
import { CONDITION_LABELS, COPY_STATUS_LABELS } from '@/app/lib/labels'
import { HistoryEntryLine } from '@/components/HistoryEntryLine'
import { SessionBoundary } from '@/components/SessionBoundary'
import { Shell } from '@/components/Shell'

/**
 * §6.6: історія примірника — усі його лоани в хронології.
 *
 * Сторінка нічого не приховує сама. Коли §9 не дозволяє бачити імена, вони не
 * приїжджають узагалі — у відповіді немає ані `owner`, ані `borrower`, ані
 * `loanId`. Фільтрувати тут було б другою реалізацією тих самих правил.
 */
export default function CopyHistoryPage() {
  const parameters = useParams<{ id: string }>()

  return (
    <SessionBoundary title="Історія примірника">
      <CopyHistoryScreen copyId={parameters.id} />
    </SessionBoundary>
  )
}

function CopyHistoryScreen({ copyId }: { copyId: string }) {
  const { state } = useCopyHistory(copyId)

  switch (state.status) {
    case 'loading':
      return (
        <Shell title="Історія примірника">
          <p className="status status--pending">Завантажую…</p>
        </Shell>
      )
    case 'error':
      return (
        <Shell title="Історія примірника">
          <FormStatus error={new Error(state.message)} />
          <p className="form__aside">
            <Link href="/library">Моя бібліотека</Link> · <Link href="/loans">Позичання</Link>
          </p>
        </Shell>
      )
    case 'ready':
      break
    default:
      return assertNever(state)
  }

  const { copy, entries } = state.data

  return (
    <Shell title="Історія примірника">
      <ul className="books">
        <li className="book">
          <Link className="book__title" href={`/works/${copy.work.id}`}>
            {copy.work.title}
          </Link>
          <AuthorLine authors={copy.authors} />
          <EditionLine edition={copy.edition} />
          <span className="book__meta">
            {COPY_STATUS_LABELS[copy.status]} · {CONDITION_LABELS[copy.condition]}
          </span>

          {entries.length === 0 ? (
            <p className="empty">Цей примірник ще нікуди не їздив.</p>
          ) : (
            <ul className="copies">
              {entries.map((entry, index) => (
                // Анонімний запис не має `loanId` навмисно (§6.6): саме за ним
                // два зрізи чужої історії склеїлися б в одну людину. Тому ключ —
                // позиція в уже впорядкованому сервером списку.
                <HistoryEntryLine
                  key={entry.names ? entry.loanId : `anon-${String(index)}`}
                  entry={entry}
                />
              ))}
            </ul>
          )}
        </li>
      </ul>
    </Shell>
  )
}
