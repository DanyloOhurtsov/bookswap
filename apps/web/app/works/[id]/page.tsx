'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  CONDITION,
  VISIBILITY,
  addCopyRequestSchema,
  copyResponseSchema,
  type Condition,
  type Edition,
  type Translation,
  type Visibility,
} from '@bookswap/shared'
import { AuthorLine, Chip, EditionLine } from '../../components/book'
import { SelectField, TextField } from '../../components/form-field'
import { FormStatus } from '../../components/form-status'
import { ApiRequestError, apiRequest, describeError } from '../../lib/api'
import { CONDITION_LABELS, VISIBILITY_LABELS } from '../../lib/labels'
import { useWork } from '../../lib/use-catalog'
import { useSession } from '../../lib/use-session'
import { validate, type FieldErrors } from '../../lib/validation'

/**
 * Сторінка твору: метадані, переклади з ознаками §10.3 і видання.
 *
 * Примірників тут немає — ні своїх, ні друзів. Каталог однаковий для всіх, а хто
 * чим володіє, живе за матрицею §9 у бібліотеках. Позначка «у кого з друзів це
 * є» приїде разом із позичанням, де вона й потрібна.
 */
export default function WorkPage() {
  const parameters = useParams<{ id: string }>()
  const router = useRouter()
  const { state: session } = useSession()
  const workId = parameters.id
  const { state, reload } = useWork(workId)

  useEffect(() => {
    if (session.status === 'guest') router.replace('/login')
  }, [session.status, router])

  if (session.status === 'loading' || state.status === 'loading') {
    return (
      <Shell>
        <p className="status status--pending">Завантажую…</p>
      </Shell>
    )
  }

  if (session.status !== 'authenticated') {
    return (
      <Shell>
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <FormStatus error={new Error(state.message)} />
        <p className="form__aside">
          <Link href="/catalog">До каталогу</Link>
        </p>
      </Shell>
    )
  }

  const { work, authors, translations, editions } = state.detail

  return (
    <main className="page">
      <h1>{work.title}</h1>
      <p className="lede">
        <AuthorLine authors={authors} />
      </p>

      <dl className="facts">
        <dt>Мова оригіналу</dt>
        <dd>{work.origLang}</dd>
        {work.firstPubYear !== null && (
          <>
            <dt>Перше видання</dt>
            <dd>{work.firstPubYear}</dd>
          </>
        )}
      </dl>

      {work.description !== null && <p>{work.description}</p>}

      <section className="friends-section">
        <h2>Переклади</h2>
        {translations.length === 0 ? (
          <p className="empty">Перекладів не додано — твір є лише мовою оригіналу.</p>
        ) : (
          <ul className="books">
            {translations.map((translation) => (
              <TranslationCard key={translation.id} translation={translation} />
            ))}
          </ul>
        )}
      </section>

      <section className="friends-section">
        <h2>Видання</h2>
        {editions.length === 0 ? (
          <p className="empty">Видань ще немає. Додайте своє — і зможете покласти примірник.</p>
        ) : (
          <ul className="books">
            {editions.map((edition) => (
              <EditionCard key={edition.id} edition={edition} onAdded={reload} />
            ))}
          </ul>
        )}
      </section>

      <p className="form__aside">
        <Link href={`/catalog/new?workId=${work.id}`}>Додати переклад або видання</Link> ·{' '}
        <Link href="/catalog">До каталогу</Link> · <Link href="/library">Моя бібліотека</Link>
      </p>
    </main>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page">
      <h1>Твір</h1>
      {children}
    </main>
  )
}

/**
 * §10.3, cold start: числового рангу немає й показувати нема чого, тож видно
 * структуровані ознаки — факти, а не думки. Це навмисно: «краще не показати
 * нічого, ніж показати 5.0 від однієї людини».
 */
function TranslationCard({ translation }: { translation: Translation }) {
  return (
    <li className="book">
      <span className="book__title">{translation.translator}</span>
      <span className="book__meta">
        {translation.lang} ← {translation.sourceLang}
        {translation.year !== null && ` · ${String(translation.year)}`}
      </span>
      <div className="chips">
        <Chip>{translation.isAbridged ? 'скорочений' : 'повний'}</Chip>
        {translation.hasNotes && <Chip>з примітками</Chip>}
        <Chip>
          {translation.editionCount === 0
            ? 'видань не додано'
            : `видань: ${String(translation.editionCount)}`}
        </Chip>
      </div>
      {translation.notes !== null && <p className="book__meta">{translation.notes}</p>}
    </li>
  )
}

function EditionCard({ edition, onAdded }: { edition: Edition; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [condition, setCondition] = useState<Condition>('GOOD')
  const [visibility, setVisibility] = useState<Visibility>('FRIENDS')
  const [note, setNote] = useState('')
  const [acquiredAt, setAcquiredAt] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<unknown>()
  const [added, setAdded] = useState<string>()
  const [errors, setErrors] = useState<FieldErrors>({})

  async function submit(): Promise<void> {
    setFailure(undefined)
    setAdded(undefined)

    const result = validate(addCopyRequestSchema, {
      editionId: edition.id,
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

      setAdded('Примірник додано до вашої бібліотеки.')
      setOpen(false)
      onAdded()
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="book">
      <EditionLine edition={edition} />

      <FormStatus error={failure} success={added} />

      {open ? (
        <div className="form">
          <SelectField
            id={`condition-${edition.id}`}
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
            id={`visibility-${edition.id}`}
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
            id={`note-${edition.id}`}
            label="Нотатка"
            hint="Видно лише вам."
            value={note}
            error={errors.note}
            onChange={(event) => {
              setNote(event.target.value)
            }}
          />

          <TextField
            id={`acquired-${edition.id}`}
            label="Коли зʼявилася"
            type="date"
            value={acquiredAt}
            error={errors.acquiredAt}
            onChange={(event) => {
              setAcquiredAt(event.target.value)
            }}
          />

          <div className="person__actions">
            <button type="button" disabled={pending} onClick={() => void submit()}>
              {pending ? 'Додаю…' : 'Додати примірник'}
            </button>
            <button
              type="button"
              className="button--ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false)
              }}
            >
              Скасувати
            </button>
          </div>
        </div>
      ) : (
        <div className="person__actions">
          <button
            type="button"
            onClick={() => {
              setOpen(true)
              setAdded(undefined)
            }}
          >
            Це моє видання
          </button>
        </div>
      )}
    </li>
  )
}
