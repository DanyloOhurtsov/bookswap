'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import {
  CONDITION,
  EDITION_FORMAT,
  VISIBILITY,
  addCopyRequestSchema,
  copyResponseSchema,
  createEditionRequestSchema,
  editionResponseSchema,
  workDetailResponseSchema,
  type BookLookupResult,
  type Condition,
  type EditionFormat,
  type Visibility,
} from '@bookswap/shared'
import { TextField, SelectField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import {
  AddBookShell,
  completeAddBook,
  continueAfterEdition,
  continueAfterTranslation,
  continueAfterWork,
  createSearchStep,
  SearchStep,
  selectExistingEdition,
  selectExistingWork,
  startNewWork,
  type AddBookStep,
  TranslationStep,
  WorkStep,
} from '@/features/catalog/add-book/index.client'
import { ApiRequestError, apiRequest, describeError } from '../../../lib/api'
import { CONDITION_LABELS, EDITION_FORMAT_LABELS, VISIBILITY_LABELS } from '../../../lib/labels'
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

function Wizard() {
  const router = useRouter()
  const parameters = useSearchParams()
  const { state: session } = useSession()
  const presetWorkId = parameters.get('workId')

  const [step, setStep] = useState<AddBookStep>(createSearchStep)
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

        setStep(selectExistingWork({ workId: detail.work.id, title: detail.work.title }))
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
      <AddBookShell step={step}>
        <p className="status status--pending">Перевіряю сесію…</p>
      </AddBookShell>
    )
  }

  if (session.status !== 'authenticated') {
    return (
      <AddBookShell step={step}>
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </AddBookShell>
    )
  }

  return (
    <AddBookShell step={step}>
      <FormStatus error={failure} />

      {step.kind === 'search' && (
        <SearchStep
          initialQuery={parameters.get('q') ?? ''}
          onFoundEdition={(selection) => {
            setStep(selectExistingEdition(selection))
          }}
          onFoundWork={(selection) => {
            setStep(selectExistingWork(selection))
          }}
          onCreateNew={(selection) => {
            setStep(startNewWork(selection))
          }}
        />
      )}

      {step.kind === 'work' && (
        <WorkStep
          initialTitle={step.initialTitle}
          lookup={step.lookup}
          onCreated={(workId, title) => {
            setStep(continueAfterWork(step, { workId, title }))
          }}
        />
      )}

      {step.kind === 'translation' && (
        <TranslationStep
          workId={step.workId}
          lookup={step.lookup}
          existingTranslations={step.existingTranslations}
          onDone={(translationId) => {
            setStep(continueAfterTranslation(step, translationId))
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
            setStep(continueAfterEdition(step, editionId))
          }}
        />
      )}

      {step.kind === 'copy' && (
        <CopyStep
          editionId={step.editionId}
          onDone={() => {
            setStep(completeAddBook(step))
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
    </AddBookShell>
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
