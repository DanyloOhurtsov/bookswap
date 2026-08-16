'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import type { VisibleLibraryGroup } from '@bookswap/shared'
import { AuthorLine, EditionLine } from '../../../components/book'
import { FormStatus } from '../../../components/form-status'
import { CONDITION_LABELS, COPY_STATUS_LABELS } from '../../../lib/labels'
import { useFriendLibrary } from '../../../lib/use-library'
import { useSession } from '../../../lib/use-session'

/**
 * §6.5: бібліотека іншої людини.
 *
 * Сторінка нічого не приховує сама — вона показує рівно те, що приїхало. Рішення
 * «що видно» ухвалює API за матрицею §9, і приватних полів у відповіді просто
 * немає. Фільтрувати їх тут було б другою реалізацією тих самих правил, яка
 * одного дня розійдеться з першою.
 *
 * Кнопки «Попросити» тут поки немає: запит на позичання — стейт-машина §5, тобто
 * наступний етап.
 */
export default function FriendLibraryPage() {
  const parameters = useParams<{ id: string }>()
  const router = useRouter()
  const { state: session } = useSession()
  const state = useFriendLibrary(parameters.id)

  useEffect(() => {
    if (session.status === 'guest') router.replace('/login')
  }, [session.status, router])

  if (session.status === 'loading' || state.status === 'loading') {
    return (
      <Shell title="Бібліотека">
        <p className="status status--pending">Завантажую…</p>
      </Shell>
    )
  }

  if (session.status !== 'authenticated') {
    return (
      <Shell title="Бібліотека">
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell title="Бібліотека">
        <FormStatus error={new Error(state.message)} />
        <p className="form__aside">
          <Link href="/friends">До друзів</Link>
        </p>
      </Shell>
    )
  }

  return (
    <Shell title={`Бібліотека: ${state.owner.displayName}`}>
      {state.groups.length === 0 ? (
        <p className="empty">Тут поки нічого не видно.</p>
      ) : (
        <ul className="books">
          {state.groups.map((group) => (
            <GroupCard key={group.edition.id} group={group} />
          ))}
        </ul>
      )}

      <p className="form__aside">
        <Link href="/friends">До друзів</Link> · <Link href="/catalog">Каталог</Link> ·{' '}
        <Link href="/library">Моя бібліотека</Link>
      </p>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      {children}
    </main>
  )
}

function GroupCard({ group }: { group: VisibleLibraryGroup }) {
  return (
    <li className="book">
      <Link className="book__title" href={`/works/${group.work.id}`}>
        {group.work.title}
        {group.counts.total > 1 && ` ×${String(group.counts.total)}`}
      </Link>
      <AuthorLine authors={group.authors} />
      <EditionLine edition={group.edition} />

      <ul className="copies">
        {group.copies.map((copy) => (
          <li className="copy" key={copy.id}>
            <span className="book__meta">
              {COPY_STATUS_LABELS[copy.status]} · {CONDITION_LABELS[copy.condition]}
              {/* §6.6: імʼя тримача показується лише коли власник це дозволив;
                  інакше приїжджає null, і видно самий статус. */}
              {!copy.isHome &&
                (copy.holder === null ? ' · зараз у когось' : ` · у ${copy.holder.displayName}`)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}
