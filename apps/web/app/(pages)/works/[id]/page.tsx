'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
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
import { AuthorLine, Chip, EditionLine } from '@/components/BookParts'
import { HistoryEntryLine } from '@/components/HistoryEntryLine'
import { SelectField, TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { SessionBoundary } from '@/components/SessionBoundary'
import { Shell } from '@/components/Shell'
import { WishlistButton } from '@/components/WishList/WishListButton'
import { assertNever } from '../../../lib/assert-never'
import { ApiRequestError, apiRequest, describeError } from '../../../lib/api'
import { CONDITION_LABELS, VISIBILITY_LABELS } from '../../../lib/labels'
import { useWork } from '../../../lib/use-catalog'
import { useWorkHistory } from '../../../lib/use-history'
import { useWishlist } from '../../../lib/use-wishlist'
import { validate, type FieldErrors } from '../../../lib/validation'

/**
 * Сторінка твору: метадані, переклади з ознаками §10.3 і видання.
 *
 * Примірників тут немає — ні своїх, ні друзів. Каталог однаковий для всіх, а хто
 * чим володіє, живе за матрицею §9 у бібліотеках.
 *
 * Знизу — історія твору (§6.6, «хто з моїх це взагалі читав»). Вона відповідає на
 * те саме питання, заради якого §6.5 хотіла позначку «у кого з друзів це є», але
 * чесніше: не «у кого лежить», а «хто справді брав», і без переліку чужих полиць.
 */
export default function WorkPage() {
  const parameters = useParams<{ id: string }>()

  return (
    <SessionBoundary title="Твір" description="Інформація про твір.">
      <WorkScreen workId={parameters.id} />
    </SessionBoundary>
  )
}

function WorkScreen({ workId }: { workId: string }) {
  const router = useRouter()
  const { state, reload, canonicalWorkId } = useWork(workId)
  const wishlist = useWishlist()

  /**
   * §6.3: reading a merged work answers 301 on the canonical one, and `fetch`
   * follows it — so the data below is already right, and only the address bar
   * is stale. Left alone it is the stale part that spreads: the URL people copy
   * out of it, bookmark and paste into chats would keep pointing at a duplicate
   * whose page is empty of everything but a title.
   *
   * `replace`, not `push`: the merged id is not a place worth being able to
   * navigate back to.
   */
  useEffect(() => {
    if (canonicalWorkId !== null) router.replace(`/works/${encodeURIComponent(canonicalWorkId)}`)
  }, [canonicalWorkId, router])

  switch (state.status) {
    case 'loading':
      return (
        <Shell title="Твір" description="Інформація про твір.">
          <p className="status status--pending">Завантажую…</p>
        </Shell>
      )
    case 'error':
      return (
        <Shell title="Твір" description="Інформація про твір.">
          <FormStatus error={new Error(state.message)} />
          <p className="form__aside">
            <Link href="/catalog">До каталогу</Link>
          </p>
        </Shell>
      )
    case 'ready':
      break
    default:
      return assertNever(state)
  }

  const { work, authors, translations, editions } = state.detail

  return (
    <Shell title={work.title}>
      <p className="lede">
        <AuthorLine authors={authors} />
      </p>

      <WishlistButton work={work} authors={authors} wishlist={wishlist} />

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

      <WorkHistorySection workId={workId} />
    </Shell>
  )
}

/**
 * §6.6: «хто з моїх це взагалі читав».
 *
 * Специфікація називає це кориснішим за історію примірника — і саме тому воно
 * тут, на сторінці твору: питання «чи варто просити цю книжку» ставлять до того,
 * як обрали конкретний том. Обсяг — примірники друзів і свої; чужі сюди не
 * потрапляють, і фільтрує їх сервер за §9.
 */
function WorkHistorySection({ workId }: { workId: string }) {
  const { state } = useWorkHistory(workId)

  switch (state.status) {
    case 'loading':
      return (
        <section className="friends-section">
          <h2>Хто з друзів це читав</h2>
          <p className="status status--pending">Завантажую…</p>
        </section>
      )
    case 'error':
      return (
        <section className="friends-section">
          <h2>Хто з друзів це читав</h2>
          <FormStatus error={new Error(state.message)} />
        </section>
      )
    case 'ready':
      return (
        <section className="friends-section">
          <h2>Хто з друзів це читав</h2>
          {state.data.entries.length === 0 ? (
            <p className="empty">Серед ваших друзів цю книжку ще ніхто не позичав.</p>
          ) : (
            <ul className="copies">
              {state.data.entries.map((item, index) => (
                <HistoryEntryLine
                  // Анонімний запис не має `loanId` навмисно (§6.6): за ним два зрізи
                  // чужої історії склеїлися б в одну людину.
                  key={item.entry.names ? item.entry.loanId : `anon-${String(index)}`}
                  entry={item.entry}
                />
              ))}
            </ul>
          )}
        </section>
      )
    default:
      return assertNever(state)
  }
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
