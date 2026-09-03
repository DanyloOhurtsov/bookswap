'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { searchCandidatesRequestSchema, type SearchCandidatesRequest } from '@bookswap/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { describeAddBookError } from '@/app/lib/catalog-errors'
import { TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { searchAddBookCandidates, type AddBookSearchResult } from '../api/search-add-book'
import type { ExistingEditionInput, ExistingWorkInput, NewWorkInput } from '../model/add-book-step'
import { SearchResults } from './SearchResults'

type SearchStepProps = {
  initialQuery: string
  onFoundEdition: (selection: ExistingEditionInput) => void
  onFoundWork: (selection: ExistingWorkInput) => void
  onCreateNew: (selection: NewWorkInput) => void
}

export function SearchStep({
  initialQuery,
  onFoundEdition,
  onFoundWork,
  onCreateNew,
}: SearchStepProps) {
  const [result, setResult] = useState<AddBookSearchResult>()
  const [failure, setFailure] = useState<unknown>()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SearchCandidatesRequest>({
    resolver: zodResolver(searchCandidatesRequestSchema),
    defaultValues: { q: initialQuery },
  })

  async function submit({ q }: SearchCandidatesRequest): Promise<void> {
    setFailure(undefined)

    try {
      setResult(await searchAddBookCandidates(q))
    } catch (error) {
      setResult(undefined)
      setFailure(error)
    }
  }

  return (
    <>
      <form className="form" onSubmit={(event) => void handleSubmit(submit)(event)} noValidate>
        <TextField
          id="search-query"
          label="Назва або ISBN"
          autoComplete="off"
          hint="Мінімум два символи."
          error={errors.q?.message}
          {...register('q')}
        />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Шукаю…' : 'Шукати'}
        </button>
      </form>

      {failure !== undefined && <FormStatus error={new Error(describeAddBookError(failure))} />}
      {result?.lookupFailure !== undefined && (
        <p className="status status--pending">{describeAddBookError(result.lookupFailure)}</p>
      )}
      {result !== undefined && (
        <SearchResults
          result={result}
          onFoundEdition={onFoundEdition}
          onFoundWork={onFoundWork}
          onCreateNew={onCreateNew}
        />
      )}
    </>
  )
}
