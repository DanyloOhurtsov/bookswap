'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { MyHistoryEntry } from '@bookswap/shared'
import { AuthorLine, EditionLine } from '@/components/BookParts'
import { FormStatus } from '@/components/Form/FormStatus'
import { useMyHistory } from '@/app/lib/use-history'
import { HistoryEntryLine } from '@/components/HistoryEntryLine'
import { EmptyState, LoadingState } from '@/components/PageState'
import { SegmentedControl, type SegmentedOption } from '@/components/SegmentedControl'
import { SessionBoundary } from '@/components/SessionBoundary'
import { Shell } from '@/components/Shell'

const HISTORY_DESCRIPTION = 'Книжки, які ви брали або позичали іншим.'

/**
 * §6.6, «Моя історія»: що я брав і що в мене брали.
 *
 * Обидва списки завжди з іменами — viewer тут сторона кожного лоану, а не
 * стороння людина, тож §6.6 до нього не застосовується.
 */
export default function HistoryPage() {
  return (
    <SessionBoundary title="Моя історія" description={HISTORY_DESCRIPTION}>
      <HistoryScreen />
    </SessionBoundary>
  )
}

type View = 'borrowed' | 'lent'

const HISTORY_VIEW_OPTIONS: readonly SegmentedOption<View>[] = [
  { value: 'borrowed', label: 'Що я брав' },
  { value: 'lent', label: 'Що в мене брали' },
]

function HistoryScreen() {
  const [view, setView] = useState<View>('borrowed')
  const { state } = useMyHistory()

  return (
    <Shell title="Моя історія" description={HISTORY_DESCRIPTION}>
      <SegmentedControl
        className="mb-8"
        label="Вигляд історії"
        value={view}
        options={HISTORY_VIEW_OPTIONS}
        onValueChange={setView}
      />

      {state.status === 'loading' && <LoadingState>Завантажую історію…</LoadingState>}
      {state.status === 'error' && <FormStatus error={new Error(state.message)} />}

      {state.status === 'ready' &&
        (state.data[view].length === 0 ? (
          <EmptyState title="Історія поки порожня">
            {view === 'borrowed' ? 'Ви ще нічого не брали.' : 'У вас ще нічого не брали.'}
          </EmptyState>
        ) : (
          <ul className="books">
            {state.data[view].map((item) => (
              <HistoryCard key={item.entry.loanId} item={item} />
            ))}
          </ul>
        ))}
    </Shell>
  )
}

function HistoryCard({ item }: { item: MyHistoryEntry }) {
  return (
    <li className="book">
      <Link className="book__title" href={`/works/${item.copy.work.id}`}>
        {item.copy.work.title}
      </Link>
      <AuthorLine authors={item.copy.authors} />
      <EditionLine edition={item.copy.edition} />

      <ul className="copies">
        <HistoryEntryLine entry={item.entry} />
      </ul>

      <span className="book__meta">
        <Link href={`/copies/${item.copy.id}/history`}>Уся історія примірника</Link>
      </span>
    </li>
  )
}
