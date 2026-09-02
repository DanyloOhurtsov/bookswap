import type { WorkDetailResponse } from '@bookswap/shared'
import { AuthorLine, EditionLine } from '@/components/BookParts'

type CandidateCardProps = {
  candidate: WorkDetailResponse
  searchedIsbn?: string
  onUseEdition: (editionId: string) => void
  onUseWork: () => void
}

export function CandidateCard({
  candidate,
  searchedIsbn,
  onUseEdition,
  onUseWork,
}: CandidateCardProps) {
  return (
    <li className="book">
      <span className="book__title">{candidate.work.title}</span>
      <AuthorLine authors={candidate.authors} />

      {candidate.editions.length === 0 ? (
        <p className="empty">Видань ще не додано.</p>
      ) : (
        <ul className="book__editions">
          {candidate.editions.map((edition) => (
            <li key={edition.id}>
              <EditionLine edition={edition} />
              {edition.isbn13 !== null && edition.isbn13 === searchedIsbn && (
                <span className="chip">точний збіг за ISBN</span>
              )}
              <button
                type="button"
                onClick={() => {
                  onUseEdition(edition.id)
                }}
              >
                Це моє видання
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="button--ghost" onClick={onUseWork}>
        У мене інше видання цього твору
      </button>
    </li>
  )
}
