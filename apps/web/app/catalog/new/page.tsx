'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  CONDITION,
  EDITION_FORMAT,
  VISIBILITY,
  addCopyRequestSchema,
  catalogSearchResponseSchema,
  copyResponseSchema,
  createEditionRequestSchema,
  createTranslationRequestSchema,
  createWorkRequestSchema,
  editionResponseSchema,
  translationResponseSchema,
  workDetailResponseSchema,
  type AuthorMatch,
  type AuthorRole,
  type Condition,
  type EditionFormat,
  type Visibility,
} from '@bookswap/shared'
import { SelectField, TextAreaField, TextField } from '../../components/form-field'
import { FormStatus } from '../../components/form-status'
import { ApiRequestError, apiRequest, describeError } from '../../lib/api'
import {
  CONDITION_LABELS,
  EDITION_FORMAT_LABELS,
  LANGUAGE_HINTS,
  VISIBILITY_LABELS,
} from '../../lib/labels'
import { useSession } from '../../lib/use-session'
import { validate, type FieldErrors } from '../../lib/validation'

/**
 * §6.3, кроки 4–5: послідовно `Work` → (опційно) `Translation` → `Edition` →
 * `Copy`.
 *
 * Кроки окремі, бо це різні сутності (§3), і злиття їх в одну форму — рівно та
 * помилка, від якої застерігає глосарій. Крок перекладу можна пропустити: книжка
 * мовою оригіналу перекладу не має.
 *
 * Автор ніколи не підбирається автоматично за збігом імені: тезки бувають, тож
 * людина або обирає наявного зі списку, або свідомо заводить нового.
 */
export default function NewBookPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <h1>Додати книжку</h1>
          <p className="status status--pending">Читаю запит…</p>
        </main>
      }
    >
      <Wizard />
    </Suspense>
  )
}

interface AuthorEntry {
  key: string
  name: string
  /** Проставляється лише вибором зі списку наявних — не збігом імені. */
  authorId?: string
  role: AuthorRole
}

type Step =
  | { kind: 'work' }
  | { kind: 'translation'; workId: string; title: string }
  | { kind: 'edition'; workId: string; title: string; translationId: string | null }
  | { kind: 'copy'; workId: string; title: string; editionId: string }
  | { kind: 'done'; workId: string; title: string }

function Wizard() {
  const router = useRouter()
  const parameters = useSearchParams()
  const { state: session } = useSession()
  const presetWorkId = parameters.get('workId')

  const [step, setStep] = useState<Step>({ kind: 'work' })
  const [failure, setFailure] = useState<unknown>()

  useEffect(() => {
    if (session.status === 'guest') router.replace('/login')
  }, [session.status, router])

  // Прихід із сторінки твору: метадані вже є, лишається доповнити їх виданням.
  useEffect(() => {
    if (presetWorkId === null) return

    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const detail = await apiRequest(`/works/${encodeURIComponent(presetWorkId ?? '')}`, {
          schema: workDetailResponseSchema,
          signal: controller.signal,
        })

        setStep({ kind: 'translation', workId: detail.work.id, title: detail.work.title })
      } catch (error) {
        if (controller.signal.aborted) return

        setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [presetWorkId])

  if (session.status === 'loading') {
    return (
      <Shell step={step}>
        <p className="status status--pending">Перевіряю сесію…</p>
      </Shell>
    )
  }

  if (session.status !== 'authenticated') {
    return (
      <Shell step={step}>
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </Shell>
    )
  }

  return (
    <Shell step={step}>
      <FormStatus error={failure} />

      {step.kind === 'work' && (
        <WorkStep
          initialTitle={parameters.get('q') ?? ''}
          onCreated={(workId, title) => {
            setStep({ kind: 'translation', workId, title })
          }}
        />
      )}

      {step.kind === 'translation' && (
        <TranslationStep
          workId={step.workId}
          onDone={(translationId) => {
            setStep({
              kind: 'edition',
              workId: step.workId,
              title: step.title,
              translationId,
            })
          }}
        />
      )}

      {step.kind === 'edition' && (
        <EditionStep
          workId={step.workId}
          translationId={step.translationId}
          onCreated={(editionId) => {
            setStep({ kind: 'copy', workId: step.workId, title: step.title, editionId })
          }}
        />
      )}

      {step.kind === 'copy' && (
        <CopyStep
          editionId={step.editionId}
          onDone={() => {
            setStep({ kind: 'done', workId: step.workId, title: step.title })
          }}
        />
      )}

      {step.kind === 'done' && (
        <>
          <div className="alert alert--ok" role="status">
            <p>«{step.title}» тепер у вашій бібліотеці.</p>
          </div>
          <p className="form__aside">
            <Link href="/library">До бібліотеки</Link> ·{' '}
            <Link href={`/works/${step.workId}`}>Сторінка твору</Link> ·{' '}
            <Link href="/catalog">Шукати далі</Link>
          </p>
        </>
      )}
    </Shell>
  )
}

const STEP_TITLES: Readonly<Record<Step['kind'], string>> = {
  work: 'Крок 1 з 4 · Твір',
  translation: 'Крок 2 з 4 · Переклад',
  edition: 'Крок 3 з 4 · Видання',
  copy: 'Крок 4 з 4 · Ваш примірник',
  done: 'Готово',
}

function Shell({ step, children }: { step: Step; children: ReactNode }) {
  return (
    <main className="page">
      <h1>Додати книжку</h1>
      <p className="lede">{STEP_TITLES[step.kind]}</p>
      {children}
    </main>
  )
}

function LanguageField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <>
      <TextField
        id={id}
        label={label}
        hint={hint ?? 'Код ISO 639-1: uk, en, pl…'}
        list="language-hints"
        autoComplete="off"
        value={value}
        error={error}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      <datalist id="language-hints">
        {LANGUAGE_HINTS.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </datalist>
    </>
  )
}

function WorkStep({
  initialTitle,
  onCreated,
}: {
  initialTitle: string
  onCreated: (workId: string, title: string) => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [origLang, setOrigLang] = useState('uk')
  const [firstPubYear, setFirstPubYear] = useState('')
  const [description, setDescription] = useState('')
  const [authors, setAuthors] = useState<AuthorEntry[]>([
    { key: 'author-0', name: '', role: 'AUTHOR' },
  ])
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

function TranslationStep({
  workId,
  onDone,
}: {
  workId: string
  onDone: (translationId: string | null) => void
}) {
  const [translator, setTranslator] = useState('')
  const [lang, setLang] = useState('uk')
  const [sourceLang, setSourceLang] = useState('en')
  const [year, setYear] = useState('')
  const [isAbridged, setIsAbridged] = useState(false)
  const [hasNotes, setHasNotes] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(createTranslationRequestSchema, {
      translator,
      lang,
      sourceLang,
      year: year === '' ? null : Number(year),
      isAbridged,
      hasNotes,
    })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      const response = await apiRequest(`/works/${workId}/translations`, {
        method: 'POST',
        body: result.data,
        schema: translationResponseSchema,
      })

      onDone(response.translation.id)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <FormStatus error={failure} />

      <p className="form__aside">Якщо ваш примірник мовою оригіналу — цей крок можна пропустити.</p>

      <TextField
        id="translation-translator"
        label="Перекладач"
        value={translator}
        error={errors.translator}
        onChange={(event) => {
          setTranslator(event.target.value)
        }}
      />

      <LanguageField
        id="translation-lang"
        label="Мова перекладу"
        value={lang}
        error={errors.lang}
        onChange={setLang}
      />

      <LanguageField
        id="translation-source"
        label="З якої мови перекладено"
        hint="Переклад з оригіналу і переказ із підрядника — різні речі (§10.3)."
        value={sourceLang}
        error={errors.sourceLang}
        onChange={setSourceLang}
      />

      <TextField
        id="translation-year"
        label="Рік перекладу"
        type="number"
        inputMode="numeric"
        value={year}
        error={errors.year}
        onChange={(event) => {
          setYear(event.target.value)
        }}
      />

      <div className="field field--checkbox">
        <input
          id="translation-abridged"
          type="checkbox"
          checked={isAbridged}
          onChange={(event) => {
            setIsAbridged(event.target.checked)
          }}
        />
        <label htmlFor="translation-abridged">Скорочений переклад</label>
      </div>

      <div className="field field--checkbox">
        <input
          id="translation-notes"
          type="checkbox"
          checked={hasNotes}
          onChange={(event) => {
            setHasNotes(event.target.checked)
          }}
        />
        <label htmlFor="translation-notes">Є примітки й коментарі перекладача</label>
      </div>

      <div className="person__actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Створюю…' : 'Далі: видання'}
        </button>
        <button
          type="button"
          className="button--ghost"
          disabled={pending}
          onClick={() => {
            onDone(null)
          }}
        >
          Пропустити — це оригінал
        </button>
      </div>
    </form>
  )
}

function EditionStep({
  workId,
  translationId,
  onCreated,
}: {
  workId: string
  translationId: string | null
  onCreated: (editionId: string) => void
}) {
  const [publisher, setPublisher] = useState('')
  const [year, setYear] = useState('')
  const [isbn13, setIsbn13] = useState('')
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

function CopyStep({ editionId, onDone }: { editionId: string; onDone: () => void }) {
  const [condition, setCondition] = useState<Condition>('GOOD')
  const [visibility, setVisibility] = useState<Visibility>('FRIENDS')
  const [note, setNote] = useState('')
  const [acquiredAt, setAcquiredAt] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(addCopyRequestSchema, {
      editionId,
      condition,
      visibility,
      note: note.trim() === '' ? null : note,
      acquiredAt: acquiredAt === '' ? null : acquiredAt,
    })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      await apiRequest('/me/library', {
        method: 'POST',
        body: result.data,
        schema: copyResponseSchema,
      })

      onDone()
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <FormStatus error={failure} />

      <SelectField
        id="copy-condition"
        label="Стан примірника"
        value={condition}
        onChange={(event) => {
          setCondition(event.target.value as Condition)
        }}
      >
        {CONDITION.map((value) => (
          <option key={value} value={value}>
            {CONDITION_LABELS[value]}
          </option>
        ))}
      </SelectField>

      <SelectField
        id="copy-visibility"
        label="Кому показувати"
        value={visibility}
        onChange={(event) => {
          setVisibility(event.target.value as Visibility)
        }}
      >
        {VISIBILITY.map((value) => (
          <option key={value} value={value}>
            {VISIBILITY_LABELS[value]}
          </option>
        ))}
      </SelectField>

      <TextField
        id="copy-note"
        label="Нотатка"
        hint="Видно лише вам."
        value={note}
        error={errors.note}
        onChange={(event) => {
          setNote(event.target.value)
        }}
      />

      <TextField
        id="copy-acquired"
        label="Коли зʼявилася"
        type="date"
        value={acquiredAt}
        error={errors.acquiredAt}
        onChange={(event) => {
          setAcquiredAt(event.target.value)
        }}
      />

      <button type="submit" disabled={pending}>
        {pending ? 'Додаю…' : 'Додати до бібліотеки'}
      </button>
    </form>
  )
}
