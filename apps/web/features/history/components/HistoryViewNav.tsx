import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { HistoryView } from '../model/history-view'

interface HistoryViewOption {
  value: HistoryView
  href: string
  label: string
}

const HISTORY_VIEW_OPTIONS: readonly HistoryViewOption[] = [
  { value: 'borrowed', href: '/history?view=borrowed', label: 'Що я брав' },
  { value: 'lent', href: '/history?view=lent', label: 'Що в мене брали' },
]

interface HistoryViewNavProps {
  view: HistoryView
}

function HistoryViewNav({ view }: HistoryViewNavProps) {
  return (
    <nav className="mb-8" aria-label="Вигляд історії">
      <ul className="inline-flex max-w-full list-none flex-wrap gap-1 rounded-xl bg-muted p-1">
        {HISTORY_VIEW_OPTIONS.map((option) => {
          const isCurrent = option.value === view

          return (
            <li key={option.value}>
              <Link
                className={cn(
                  'inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isCurrent && 'bg-background text-foreground shadow-sm hover:bg-background',
                )}
                href={option.href}
                aria-current={isCurrent ? 'page' : undefined}
              >
                {option.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export { HistoryViewNav }
