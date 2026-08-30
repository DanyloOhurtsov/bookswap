'use client'

import { useState, type FormEvent } from 'react'
import {
  bookLookupResponseSchema,
  isValidIsbn13,
  normalizeIsbn13,
  searchCandidatesRequestSchema,
  searchCandidatesResponseSchema,
  type BookLookupResult,
  type Translation,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { apiRequest } from '@/app/lib/api'
import { describeAddBookError } from '@/app/lib/catalog-errors'
import { validate, type FieldErrors } from '@/app/lib/validation'
import { AuthorLine, EditionLine } from '@/components/BookParts'
import { TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'

/**
 * §6.3, крок 1–2 (Етап 7c/7d): «можливо, це вже є?» до того, як людина почне
 * заповнювати форму.
 *
 * Запит іде через `/catalog/search/candidates` — окремий ендпоінт від
 * загального `/catalog/search` на сторінці `/catalog`: тут кандидат несе й
 * `Translation`, і всі `Edition`, бо саме на виданні людина впізнає свій
 * примірник.
 *
 * Якщо запит виглядає як ISBN-13, паралельно летить `/catalog/lookup` —
 * автозаповнення для гілки «нічого не знайдено». Помилка лукапу (429, 504,
 * помилка провайдера) не блокує показ кандидатів: це лише чернетка форми, а не
 * умова пошуку.
 */
export function SearchStep({
  initialQuery,
  onFoundEdition,
  onFoundWork,
  onCreateNew,
}: {
  initialQuery: string
  onFoundEdition: (workId: string, title: string, editionId: string) => void
  onFoundWork: (found: {
    workId: string
    title: string
    isbn?: string
    lookup?: BookLookupResult
    existingTranslations?: Translation[]
  }) => void
  onCreateNew: (initialTitle: string, isbn?: string, lookup?: BookLookupResult) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [lookupNote, setLookupNote] = useState<string>()
  const [pending, setPending] = useState(false)
  const [candidates, setCandidates] = useState<WorkDetailResponse[]>()
  const [lookup, setLookup] = useState<BookLookupResult>()
  const [searchedIsbn, setSearchedIsbn] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const result = validate(searchCandidatesRequestSchema, { q: query })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setFailure(undefined)
    setLookupNote(undefined)
    setCandidates(undefined)
    setLookup(undefined)
    setPending(true)

    const trimmed = result.data.q
    const isbn = isValidIsbn13(trimmed) ? normalizeIsbn13(trimmed) : undefined
    setSearchedIsbn(isbn)

    try {
      const [candidatesResponse, lookupResponse] = await Promise.all([
        apiRequest(`/catalog/search/candidates?q=${encodeURIComponent(trimmed)}`, {
          schema: searchCandidatesResponseSchema,
        }),
        isbn === undefined
          ? Promise.resolve(undefined)
          : apiRequest(`/catalog/lookup?isbn=${encodeURIComponent(isbn)}`, {
              schema: bookLookupResponseSchema,
            }).catch((error: unknown) => {
              // Некритично: чернетки просто не буде, кандидати вже шукаються окремо.
              setLookupNote(describeAddBookError(error))
              return undefined
            }),
      ])

      setCandidates(candidatesResponse.candidates)
      setLookup(lookupResponse?.result)
    } catch (error) {
      setFailure(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <TextField
          id="search-query"
          label="Назва або ISBN"
          autoComplete="off"
          hint="Мінімум два символи."
          value={query}
          error={errors.q ?? errors.form}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Шукаю…' : 'Шукати'}
        </button>
      </form>

      {failure !== undefined && <FormStatus error={new Error(describeAddBookError(failure))} />}

      {lookupNote !== undefined && <p className="status status--pending">{lookupNote}</p>}

      {candidates !== undefined && candidates.length === 0 && (
        <>
          <p className="empty">Нічого схожого не знайшлося. Заведемо новий твір.</p>
          <button
            type="button"
            onClick={() => {
              onCreateNew(lookup?.title ?? query.trim(), searchedIsbn, lookup)
            }}
          >
            Створити новий твір
          </button>
        </>
      )}

      {candidates !== undefined && candidates.length > 0 && (
        <>
          <p className="lede">Можливо, це один із цих творів?</p>
          <ul className="books">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.work.id}
                candidate={candidate}
                searchedIsbn={searchedIsbn}
                onUseEdition={(editionId) => {
                  onFoundEdition(candidate.work.id, candidate.work.title, editionId)
                }}
                onUseWork={() => {
                  // Дані lookup (Етап 7b) і наявні переклади цього твору
                  // (§6.3 п.12) їдуть далі разом із вибором — інакше нове
                  // Edition/Translation губить чернетку, підставлену на кроці
                  // пошуку.
                  onFoundWork({
                    workId: candidate.work.id,
                    title: candidate.work.title,
                    isbn: searchedIsbn,
                    lookup,
                    existingTranslations: candidate.translations,
                  })
                }}
              />
            ))}
          </ul>

          <p className="form__aside">
            Не знайшли своє видання?{' '}
            <button
              type="button"
              className="button--ghost"
              onClick={() => {
                onCreateNew(lookup?.title ?? query.trim(), searchedIsbn, lookup)
              }}
            >
              Завести новий твір
            </button>
          </p>
        </>
      )}
    </>
  )
}

function CandidateCard({
  candidate,
  searchedIsbn,
  onUseEdition,
  onUseWork,
}: {
  candidate: WorkDetailResponse
  searchedIsbn: string | undefined
  onUseEdition: (editionId: string) => void
  onUseWork: () => void
}) {
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
