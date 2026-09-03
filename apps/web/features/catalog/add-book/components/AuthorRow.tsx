'use client'

import {
  authorRoleSchema,
  catalogSearchResponseSchema,
  type AuthorMatch,
  type AuthorRole,
  type CreateWorkRequest,
  type WorkAuthorInput,
} from '@bookswap/shared'
import { useState } from 'react'
import { useController, type Control } from 'react-hook-form'
import { apiRequest } from '@/app/lib/api'
import { TextField, SelectField } from '@/components/Form/FormFields'

const AUTHOR_ROLE_OPTIONS: readonly { value: AuthorRole; label: string }[] = [
  { value: 'AUTHOR', label: 'автор' },
  { value: 'CO_AUTHOR', label: 'співавтор' },
  { value: 'EDITOR', label: 'редактор' },
  { value: 'ILLUSTRATOR', label: 'ілюстратор' },
]

type AuthorRowProps = {
  control: Control<CreateWorkRequest>
  index: number
  error?: string
  onRemove?: () => void
}

type AuthorSearchResultsProps = {
  candidates: AuthorMatch[]
  onSelect: (candidate: AuthorMatch) => void
}

function withRole(author: WorkAuthorInput, role: AuthorRole): WorkAuthorInput {
  return author.authorId === undefined
    ? { name: author.name ?? '', role }
    : { authorId: author.authorId, role }
}

async function searchAuthorCandidates(name: string): Promise<AuthorMatch[]> {
  const response = await apiRequest(`/catalog/search?q=${encodeURIComponent(name)}`, {
    schema: catalogSearchResponseSchema,
  })

  return response.authorMatches
}

function AuthorSearchResults({ candidates, onSelect }: AuthorSearchResultsProps) {
  if (candidates.length === 0) {
    return <p className="empty">Схожих авторів не знайшлося — буде створено нового.</p>
  }

  return (
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
          <button type="button" onClick={() => onSelect(candidate)}>
            Це він/вона
          </button>
        </li>
      ))}
    </ul>
  )
}

export function AuthorRow({ control, index, error, onRemove }: AuthorRowProps) {
  const { field } = useController({ control, name: `authors.${index}` as const })
  const author = field.value
  const [displayName, setDisplayName] = useState(author.name ?? '')
  const [candidates, setCandidates] = useState<AuthorMatch[]>()
  const [isSearching, setIsSearching] = useState(false)

  async function findCandidates(): Promise<void> {
    if (displayName.trim().length < 2) return
    setIsSearching(true)

    try {
      setCandidates(await searchAuthorCandidates(displayName.trim()))
    } catch {
      setCandidates([])
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="author-row">
      <TextField
        id={`author-name-${field.name}`}
        label="Імʼя"
        autoComplete="off"
        value={displayName}
        error={error}
        hint={
          author.authorId === undefined
            ? 'Буде створено нового автора.'
            : 'Вибрано наявного автора з каталогу.'
        }
        onChange={(event) => {
          setDisplayName(event.target.value)
          field.onChange({ name: event.target.value, role: author.role ?? 'AUTHOR' })
        }}
      />

      <SelectField
        id={`author-role-${field.name}`}
        label="Роль"
        value={author.role ?? 'AUTHOR'}
        onChange={(event) => {
          field.onChange(withRole(author, authorRoleSchema.parse(event.target.value)))
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
          disabled={isSearching}
          onClick={() => void findCandidates()}
        >
          {isSearching ? 'Шукаю…' : 'Чи є такий уже?'}
        </button>
        {onRemove !== undefined && (
          <button type="button" className="button--ghost" onClick={onRemove}>
            Прибрати
          </button>
        )}
      </div>

      {candidates !== undefined && (
        <AuthorSearchResults
          candidates={candidates}
          onSelect={(candidate) => {
            setDisplayName(candidate.name)
            field.onChange({ authorId: candidate.id, role: author.role ?? 'AUTHOR' })
            setCandidates(undefined)
          }}
        />
      )}
    </div>
  )
}
