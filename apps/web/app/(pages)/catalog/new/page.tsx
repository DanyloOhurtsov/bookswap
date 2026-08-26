'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  CONDITION,
  EDITION_FORMAT,
  VISIBILITY,
  addCopyRequestSchema,
  bookLookupResponseSchema,
  catalogSearchResponseSchema,
  copyResponseSchema,
  createEditionRequestSchema,
  createTranslationRequestSchema,
  createWorkRequestSchema,
  editionResponseSchema,
  isValidIsbn13,
  normalizeIsbn13,
  searchCandidatesRequestSchema,
  searchCandidatesResponseSchema,
  translationResponseSchema,
  workDetailResponseSchema,
  type AuthorMatch,
  type AuthorRole,
  type BookLookupResult,
  type Condition,
  type EditionFormat,
  type Translation,
  type Visibility,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { AuthorLine, EditionLine } from '@/components/BookParts'
import { TextField, SelectField, TextAreaField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { ApiRequestError, apiRequest, describeError } from '../../../lib/api'
import { describeAddBookError } from '../../../lib/catalog-errors'
import {
  CONDITION_LABELS,
  EDITION_FORMAT_LABELS,
  LANGUAGE_HINTS,
  VISIBILITY_LABELS,
} from '../../../lib/labels'
import { mapLookupResultToDraft } from '../../../lib/lookup-mapping'
import { useSession } from '../../../lib/use-session'
import { validate, type FieldErrors } from '../../../lib/validation'

/**
 * §6.3, кроки 1–5: спершу пошук дублікатів (Етап 7c), потім — залежно від того,
 * що знайшлося, — одна з чотирьох гілок:
 *
 * 1. Знайшовся точний збіг `Edition` — створюється лише `Copy`.
 * 2. Знайшовся `Work` без потрібного видання — одразу `Translation` (опційно) →
 *    `Edition` → `Copy`.
 * 3. Нічого не знайшлося — повний ланцюг `Work` → `Translation` → `Edition` →
 *    `Copy`.
 *
 * Кроки самого ланцюга окремі, бо це різні сутності (§3), і злиття їх в одну
 * форму — рівно та помилка, від якої застерігає глосарій. Крок перекладу можна
 * пропустити: книжка мовою оригіналу перекладу не має.
 *
 * Пошук за ISBN паралельно тягне автозаповнення (Етап 7b, `/catalog/lookup`):
 * дані підставляються у форму `Work`/`Edition`, але лишаються звичайними
 * контрольованими полями — людина бачить і за потреби виправляє їх до
 * збереження.
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
  | { kind: 'search' }
  | { kind: 'work'; initialTitle: string; isbn?: string; lookup?: BookLookupResult }
  | {
      kind: 'translation'
      workId: string
      title: string
      isbn?: string
      lookup?: BookLookupResult
      /**
       * Лише в гілці «наявний Work» (Етап 7c/7d, п.12): переклади, які вже є
       * в цього твору — щоб не заводити дублікат `Translation`, коли підходить
       * наявний. У гілці «нічого не знайдено» Work щойно створений, тож тут
       * завжди `undefined`.
       */
      existingTranslations?: Translation[]
    }
  | {
      kind: 'edition'
      workId: string
      title: string
      translationId: string | null
      isbn?: string
      lookup?: BookLookupResult
    }
  | { kind: 'copy'; workId: string; title: string; editionId: string }
  | { kind: 'done'; workId: string; title: string }

function Wizard() {
  const router = useRouter()
  const parameters = useSearchParams()
  const { state: session } = useSession()
  const presetWorkId = parameters.get('workId')

  const [step, setStep] = useState<Step>({ kind: 'search' })
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

      {step.kind === 'search' && (
        <SearchStep
          initialQuery={parameters.get('q') ?? ''}
          onFoundEdition={(workId, title, editionId) => {
            setStep({ kind: 'copy', workId, title, editionId })
          }}
          onFoundWork={(workId, title, isbn, lookup, existingTranslations) => {
            setStep({ kind: 'translation', workId, title, isbn, lookup, existingTranslations })
          }}
          onCreateNew={(initialTitle, isbn, lookup) => {
            setStep({ kind: 'work', initialTitle, isbn, lookup })
          }}
        />
      )}

      {step.kind === 'work' && (
        <WorkStep
          initialTitle={step.initialTitle}
          lookup={step.lookup}
          onCreated={(workId, title) => {
            setStep({ kind: 'translation', workId, title, isbn: step.isbn, lookup: step.lookup })
          }}
        />
      )}

      {step.kind === 'translation' && (
        <TranslationStep
          workId={step.workId}
          lookup={step.lookup}
          existingTranslations={step.existingTranslations}
          onDone={(translationId) => {
            setStep({
              kind: 'edition',
              workId: step.workId,
              title: step.title,
              translationId,
              isbn: step.isbn,
              lookup: step.lookup,
            })
          }}
        />
      )}

      {step.kind === 'edition' && (
        <EditionStep
          workId={step.workId}
          translationId={step.translationId}
          lookup={step.lookup}
          initialIsbn={step.isbn}
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

/**
 * Без «крок X із N»: залежно від гілки (наявне видання / наявний твір / нічого
 * не знайдено) шлях має різну довжину, і фіксований лічильник брехав би на
 * коротких гілках.
 */
const STEP_TITLES: Readonly<Record<Step['kind'], string>> = {
  search: 'Пошук у каталозі',
  work: 'Твір',
  translation: 'Переклад',
  edition: 'Видання',
  copy: 'Ваш примірник',
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
function SearchStep({
  initialQuery,
  onFoundEdition,
  onFoundWork,
  onCreateNew,
}: {
  initialQuery: string
  onFoundEdition: (workId: string, title: string, editionId: string) => void
  onFoundWork: (
    workId: string,
    title: string,
    isbn?: string,
    lookup?: BookLookupResult,
    existingTranslations?: Translation[],
  ) => void
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
                  onFoundWork(
                    candidate.work.id,
                    candidate.work.title,
                    searchedIsbn,
                    lookup,
                    candidate.translations,
                  )
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

function WorkStep({
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

function TranslationStep({
  workId,
  lookup,
  existingTranslations,
  onDone,
}: {
  workId: string
  lookup?: BookLookupResult
  existingTranslations?: Translation[]
  onDone: (translationId: string | null) => void
}) {
  const draft = mapLookupResultToDraft(lookup)
  const [translator, setTranslator] = useState('')
  // §6.3 п.7: мова ISBN-видання описує мову цього тексту — єдине домен-коректне
  // місце для неї тут, у мові перекладу. `sourceLang` лишається незаповненою:
  // з якої мови перекладено provider не повідомляє, і вгадувати заборонено.
  const [lang, setLang] = useState(draft.translationLang ?? 'uk')
  const [sourceLang, setSourceLang] = useState('')
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
    <>
      {existingTranslations !== undefined && existingTranslations.length > 0 && (
        <>
          <p className="lede">У цього твору вже є переклади — можливо, ваш серед них.</p>
          <ul className="books">
            {existingTranslations.map((existing) => (
              <li className="book" key={existing.id}>
                <span className="book__meta">
                  {existing.translator} · {existing.lang}
                  {existing.year === null ? '' : ` · ${String(existing.year)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Наявний переклад передається як є — lookup-мова сюди не
                    // потрапляє: наявний запис не редагується цим кроком.
                    onDone(existing.id)
                  }}
                >
                  Використати цей переклад
                </button>
              </li>
            ))}
          </ul>
          <p className="form__aside">Або заведіть новий переклад нижче.</p>
        </>
      )}

      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormStatus error={failure} />

        <p className="form__aside">
          Якщо ваш примірник мовою оригіналу — цей крок можна пропустити.
        </p>

        {draft.translationLang !== undefined && (
          <div className="alert alert--ok" role="status">
            <p>
              Мову підставлено з зовнішнього джерела за виданням — перевірте й виправте за потреби.
            </p>
          </div>
        )}

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
    </>
  )
}

function EditionStep({
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
