'use client'

import { useState, type FormEvent } from 'react'
import {
  catalogSearchResponseSchema,
  createWorkRequestSchema,
  workDetailResponseSchema,
  type AuthorMatch,
  type AuthorRole,
  type BookLookupResult,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { mapLookupResultToDraft } from '@/app/lib/lookup-mapping'
import { validate, type FieldErrors } from '@/app/lib/validation'
import { SelectField, TextAreaField, TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { LanguageField } from '@/components/Form/LanguageField'

interface AuthorEntry {
  key: string
  name: string
  /** Set only after an explicit choice; equal names are not identities. */
  authorId?: string
  role: AuthorRole
}

export function WorkStep({
  initialTitle,
  lookup,
  onCreated,
}: {
  initialTitle: string
  lookup?: BookLookupResult
  onCreated: (workId: string, title: string) => void
}) {
  const draft = mapLookupResultToDraft(lookup)
  const [title, setTitle] = useState(draft.work.title === '' ? initialTitle : draft.work.title)
  const [origLang, setOrigLang] = useState('uk')
  // §6.3 п.2–3: рік ISBN-видання (`publishedYear`) описує конкретне Edition, не
  // твір — тому тут навмисно немає жодного значення з lookup. Work.firstPubYear
  // автозаповнюється лише окремим work-level полем, якого провайдер не дає.
  const [firstPubYear, setFirstPubYear] = useState('')
  const [description, setDescription] = useState('')
  const [authors, setAuthors] = useState<AuthorEntry[]>(
    draft.work.authors.length === 0
      ? [{ key: 'author-0', name: '', role: 'AUTHOR' }]
      : draft.work.authors.map((name, index) => ({
          key: `author-${String(index)}`,
          name,
          role: 'AUTHOR' as const,
        })),
  )
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  function updateAuthor(key: string, changes: Partial<AuthorEntry>): void {
    setAuthors((current) =>
      current.map((author) => (author.key === key ? { ...author, ...changes } : author)),
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(createWorkRequestSchema, {
      title,
      origLang,
      firstPubYear: firstPubYear === '' ? null : Number(firstPubYear),
      description: description.trim() === '' ? null : description,
      // Вибраний зі списку автор іде як id; уведений руками — як імʼя. Рівно
      // одне з двох, інакше контракт відхилить запис.
      authors: authors.map((author) =>
        author.authorId === undefined
          ? { name: author.name, role: author.role }
          : { authorId: author.authorId, role: author.role },
      ),
    })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      const detail = await apiRequest('/works', {
        method: 'POST',
        body: result.data,
        schema: workDetailResponseSchema,
      })

      onCreated(detail.work.id, detail.work.title)
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
        id="work-title"
        label="Назва твору"
        required
        value={title}
        error={errors.title}
        onChange={(event) => {
          setTitle(event.target.value)
        }}
      />

      <LanguageField
        id="work-lang"
        label="Мова оригіналу"
        hint="Мова, якою твір написано, а не мова вашого примірника."
        value={origLang}
        error={errors.origLang}
        onChange={setOrigLang}
      />

      <TextField
        id="work-year"
        label="Рік першого видання"
        type="number"
        inputMode="numeric"
        value={firstPubYear}
        error={errors.firstPubYear}
        onChange={(event) => {
          setFirstPubYear(event.target.value)
        }}
      />

      <TextAreaField
        id="work-description"
        label="Опис"
        rows={3}
        value={description}
        error={errors.description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />

      <fieldset className="authors">
        <legend>Автори</legend>
        {authors.map((author, index) => (
          <AuthorRow
            key={author.key}
            author={author}
            error={errors[`authors.${String(index)}`] ?? errors.authors}
            onChange={(changes) => {
              updateAuthor(author.key, changes)
            }}
            onRemove={
              authors.length === 1
                ? undefined
                : () => {
                    setAuthors((current) => current.filter((item) => item.key !== author.key))
                  }
            }
          />
        ))}
        <button
          type="button"
          className="button--ghost"
          onClick={() => {
            setAuthors((current) => [
              ...current,
              {
                key: `author-${String(current.length)}-${String(Date.now())}`,
                name: '',
                role: 'AUTHOR',
              },
            ])
          }}
        >
          Додати ще автора
        </button>
      </fieldset>

      <button type="submit" disabled={pending}>
        {pending ? 'Створюю…' : 'Далі: переклад'}
      </button>
    </form>
  )
}

const AUTHOR_ROLE_OPTIONS: readonly { value: AuthorRole; label: string }[] = [
  { value: 'AUTHOR', label: 'автор' },
  { value: 'CO_AUTHOR', label: 'співавтор' },
  { value: 'EDITOR', label: 'редактор' },
  { value: 'ILLUSTRATOR', label: 'ілюстратор' },
]

function AuthorRow({
  author,
  error,
  onChange,
  onRemove,
}: {
  author: AuthorEntry
  error?: string
  onChange: (changes: Partial<AuthorEntry>) => void
  onRemove?: () => void
}) {
  const [candidates, setCandidates] = useState<AuthorMatch[]>()
  const [searching, setSearching] = useState(false)

  async function findCandidates(): Promise<void> {
    if (author.name.trim().length < 2) return

    setSearching(true)

    try {
      const response = await apiRequest(`/catalog/search?q=${encodeURIComponent(author.name)}`, {
        schema: catalogSearchResponseSchema,
      })

      setCandidates(response.authorMatches)
    } catch {
      setCandidates([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="author-row">
      <TextField
        id={`author-name-${author.key}`}
        label="Імʼя"
        autoComplete="off"
        value={author.name}
        error={error}
        hint={
          author.authorId === undefined
            ? 'Буде створено нового автора.'
            : 'Вибрано наявного автора з каталогу.'
        }
        onChange={(event) => {
          // Правка імені скасовує вибір: інакше в базу пішов би чужий id під
          // новим написанням.
          onChange({ name: event.target.value, authorId: undefined })
        }}
      />

      <SelectField
        id={`author-role-${author.key}`}
        label="Роль"
        value={author.role}
        onChange={(event) => {
          onChange({ role: event.target.value as AuthorRole })
        }}
      >
        {AUTHOR_ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>

      <div className="person__actions">
        <button
          type="button"
          className="button--ghost"
          disabled={searching}
          onClick={() => void findCandidates()}
        >
          {searching ? 'Шукаю…' : 'Чи є такий уже?'}
        </button>
        {onRemove !== undefined && (
          <button type="button" className="button--ghost" onClick={onRemove}>
            Прибрати
          </button>
        )}
      </div>

      {candidates !== undefined &&
        (candidates.length === 0 ? (
          <p className="empty">Схожих авторів не знайшлося — буде створено нового.</p>
        ) : (
          <ul className="people">
            {candidates.map((candidate) => (
              <li className="person" key={candidate.id}>
                <span>
                  <span className="person__name">{candidate.name}</span>
                  <span className="person__meta">
                    творів у каталозі: {candidate.workCount}
                    {candidate.nameLatin !== null && ` · ${candidate.nameLatin}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ authorId: candidate.id, name: candidate.name })
                    setCandidates(undefined)
                  }}
                >
                  Це він/вона
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
