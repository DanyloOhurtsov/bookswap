import Link from 'next/dist/client/link'
import { type CatalogSearchResult } from '@bookswap/shared'
import { AuthorLine, EditionLine } from '@/components/BookParts'

const MATCH_LABELS: Readonly<Record<CatalogSearchResult['matchedOn'], string>> = {
  TITLE: 'збіг за назвою',
  AUTHOR: 'збіг за автором',
  ISBN: 'точний збіг за ISBN',
}

function CatalogItem({ result }: { result: CatalogSearchResult }) {
  return (
    <li className="book">
      <Link className="book__title" href={`/works/${result.work.id}`}>
        {result.work.title}
      </Link>
      <AuthorLine authors={result.authors} />
      <span className="book__meta">{MATCH_LABELS[result.matchedOn]}</span>

      {result.editions.length === 0 ? (
        <p className="empty">Видань ще не додано.</p>
      ) : (
        <ul className="book__editions">
          {result.editions.map((edition) => (
            <li key={edition.id}>
              <EditionLine edition={edition} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export { CatalogItem }
