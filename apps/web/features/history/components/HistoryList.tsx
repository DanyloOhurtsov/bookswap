import Link from 'next/link'
import type { MyHistoryEntry } from '@bookswap/shared'
import { AuthorLine, EditionLine } from '@/components/BookParts'
import { HistoryEntryLine } from '@/components/HistoryEntryLine'
import { EmptyState } from '@/components/PageState'

interface HistoryListProps {
  items: MyHistoryEntry[]
  emptyMessage: string
}

interface HistoryCardProps {
  item: MyHistoryEntry
}

function HistoryList({ items, emptyMessage }: HistoryListProps) {
  if (items.length === 0) {
    return <EmptyState title="Історія поки порожня">{emptyMessage}</EmptyState>
  }

  return (
    <ul className="books">
      {items.map((item) => (
        <HistoryCard key={item.entry.loanId} item={item} />
      ))}
    </ul>
  )
}

function HistoryCard({ item }: HistoryCardProps) {
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

export { HistoryList }
