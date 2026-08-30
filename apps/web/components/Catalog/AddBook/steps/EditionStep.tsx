'use client'

import { useState, type FormEvent } from 'react'
import {
  EDITION_FORMAT,
  createEditionRequestSchema,
  editionResponseSchema,
  type BookLookupResult,
  type EditionFormat,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { EDITION_FORMAT_LABELS } from '@/app/lib/labels'
import { mapLookupResultToDraft } from '@/app/lib/lookup-mapping'
import { validate, type FieldErrors } from '@/app/lib/validation'
import { SelectField, TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'

export function EditionStep({
  workId,
  translationId,
  lookup,
  initialIsbn,
  onCreated,
}: {
  workId: string
  translationId: string | null
  lookup?: BookLookupResult
  initialIsbn?: string
  onCreated: (editionId: string) => void
}) {
  const draft = mapLookupResultToDraft(lookup)
  const [publisher, setPublisher] = useState(draft.edition.publisher)
  const [year, setYear] = useState(draft.edition.year)
  const [coverUrl, setCoverUrl] = useState(draft.edition.coverUrl)
  const [isbn13, setIsbn13] = useState(initialIsbn ?? '')
  const [pageCount, setPageCount] = useState('')
  const [format, setFormat] = useState<EditionFormat>('PAPERBACK')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(createEditionRequestSchema, {
      translationId,
      publisher: publisher.trim() === '' ? null : publisher,
      year: year === '' ? null : Number(year),
      isbn13: isbn13.trim() === '' ? null : isbn13,
      pageCount: pageCount === '' ? null : Number(pageCount),
      coverUrl: coverUrl.trim() === '' ? null : coverUrl,
      format,
    })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      const response = await apiRequest(`/works/${workId}/editions`, {
        method: 'POST',
        body: result.data,
        schema: editionResponseSchema,
      })

      onCreated(response.edition.id)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <FormStatus error={failure} />

      {lookup !== undefined && (
        <div className="alert alert--ok" role="status">
          <p>Поля нижче підставлено з зовнішнього джерела — перевірте й виправте за потреби.</p>
        </div>
      )}

      <TextField
        id="edition-publisher"
        label="Видавництво"
        value={publisher}
        error={errors.publisher}
        onChange={(event) => {
          setPublisher(event.target.value)
        }}
      />

      <TextField
        id="edition-year"
        label="Рік видання"
        type="number"
        inputMode="numeric"
        value={year}
        error={errors.year}
        onChange={(event) => {
          setYear(event.target.value)
        }}
      />

      <TextField
        id="edition-isbn"
        label="ISBN-13"
        inputMode="numeric"
        hint="Дефіси можна лишити. Контрольна сума перевіряється."
        value={isbn13}
        error={errors.isbn13}
        onChange={(event) => {
          setIsbn13(event.target.value)
        }}
      />

      <TextField
        id="edition-pages"
        label="Сторінок"
        type="number"
        inputMode="numeric"
        value={pageCount}
        error={errors.pageCount}
        onChange={(event) => {
          setPageCount(event.target.value)
        }}
      />

      <TextField
        id="edition-cover"
        label="Обкладинка (посилання)"
        type="url"
        hint="Посилання на зображення обкладинки."
        value={coverUrl}
        error={errors.coverUrl}
        onChange={(event) => {
          setCoverUrl(event.target.value)
        }}
      />

      <SelectField
        id="edition-format"
        label="Палітурка"
        value={format}
        onChange={(event) => {
          setFormat(event.target.value as EditionFormat)
        }}
      >
        {EDITION_FORMAT.map((value) => (
          <option key={value} value={value}>
            {EDITION_FORMAT_LABELS[value]}
          </option>
        ))}
      </SelectField>

      <button type="submit" disabled={pending}>
        {pending ? 'Створюю…' : 'Далі: мій примірник'}
      </button>
    </form>
  )
}
