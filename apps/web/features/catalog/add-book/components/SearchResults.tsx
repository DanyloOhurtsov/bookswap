import type { WorkDetailResponse } from '@bookswap/shared'
import type { AddBookSearchResult } from '../api/search-add-book'
import type { ExistingEditionInput, ExistingWorkInput, NewWorkInput } from '../model/add-book-step'
import { CandidateCard } from './CandidateCard'

type SearchResultsProps = {
  result: AddBookSearchResult
  onFoundEdition: (selection: ExistingEditionInput) => void
  onFoundWork: (selection: ExistingWorkInput) => void
  onCreateNew: (selection: NewWorkInput) => void
}

function newWorkInput(result: AddBookSearchResult): NewWorkInput {
  return {
    initialTitle: result.lookup?.title ?? result.query,
    ...(result.isbn === undefined ? {} : { isbn: result.isbn }),
    ...(result.lookup === undefined ? {} : { lookup: result.lookup }),
  }
}

function existingWorkInput(
  result: AddBookSearchResult,
  candidate: WorkDetailResponse,
): ExistingWorkInput {
  return {
    workId: candidate.work.id,
    title: candidate.work.title,
    existingTranslations: candidate.translations,
    ...(result.isbn === undefined ? {} : { isbn: result.isbn }),
    ...(result.lookup === undefined ? {} : { lookup: result.lookup }),
  }
}

export function SearchResults({
  result,
  onFoundEdition,
  onFoundWork,
  onCreateNew,
}: SearchResultsProps) {
  if (result.candidates.length === 0) {
    return (
      <>
        <p className="empty">Нічого схожого не знайшлося. Заведемо новий твір.</p>
        <button type="button" onClick={() => onCreateNew(newWorkInput(result))}>
          Створити новий твір
        </button>
      </>
    )
  }

  return (
    <>
      <p className="lede">Можливо, це один із цих творів?</p>
      <ul className="books">
        {result.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.work.id}
            candidate={candidate}
            searchedIsbn={result.isbn}
            onUseEdition={(editionId) => {
              onFoundEdition({
                workId: candidate.work.id,
                title: candidate.work.title,
                editionId,
              })
            }}
            onUseWork={() => onFoundWork(existingWorkInput(result, candidate))}
          />
        ))}
      </ul>

      <p className="form__aside">
        Не знайшли своє видання?{' '}
        <button
          type="button"
          className="button--ghost"
          onClick={() => onCreateNew(newWorkInput(result))}
        >
          Завести новий твір
        </button>
      </p>
    </>
  )
}
