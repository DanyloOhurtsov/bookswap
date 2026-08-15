'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  friendshipStateResponseSchema,
  userSearchRequestSchema,
  userSearchResponseSchema,
  type Friend,
  type FriendRelation,
  type FriendRequest,
  type PublicUser,
  type UserSearchResult,
} from '@bookswap/shared'
import { ConfirmDialog } from '../components/confirm-dialog'
import { SelectField, TextField } from '../components/form-field'
import { FormStatus } from '../components/form-status'
import { ApiRequestError, apiRequest, describeError } from '../lib/api'
import { useFriends } from '../lib/use-friends'
import { useSession } from '../lib/use-session'
import { validate, type FieldErrors } from '../lib/validation'

/**
 * §6.1: два взаємовиключні режими пошуку. Режим — явний вибір людини, а не
 * здогад по вмісту поля.
 */
type SearchMode = 'name' | 'email'

interface SearchQuery {
  mode: SearchMode
  /** Уже нормалізоване значення: для пошти — trim + нижній регістр зі схеми. */
  value: string
}

/** Руйнівна дія, яку користувач має підтвердити перед виконанням. */
interface Confirmation {
  title: string
  description: string
  confirmLabel: string
  run: () => Promise<void>
}

export default function FriendsPage() {
  const router = useRouter()
  const { state } = useSession()

  useEffect(() => {
    if (state.status === 'guest') router.replace('/login')
  }, [state.status, router])

  if (state.status === 'loading') {
    return (
      <Shell>
        <p className="status status--pending">Перевіряю сесію…</p>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <FormStatus error={new Error(state.message)} />
      </Shell>
    )
  }

  if (state.status === 'guest') {
    return (
      <Shell>
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </Shell>
    )
  }

  return <FriendsView />
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page">
      <h1>Друзі</h1>
      {children}
    </main>
  )
}

function FriendsView() {
  const { state, reload } = useFriends()
  const [failure, setFailure] = useState<unknown>()
  const [busyKey, setBusyKey] = useState<string>()
  const [confirmation, setConfirmation] = useState<Confirmation>()

  // Пошук живе окремо від списків: він не має перезавантажуватися разом із ними.
  const [mode, setMode] = useState<SearchMode>('name')
  const [query, setQuery] = useState('')
  const [lastSearch, setLastSearch] = useState<SearchQuery>()
  const [results, setResults] = useState<UserSearchResult[]>()
  const [searching, setSearching] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  /**
   * §6.1 має два взаємовиключні режими: за імʼям — частковий збіг, за поштою —
   * ТІЛЬКИ точний. Режим обирає людина перемикачем, а не здогад по вмісту рядка:
   * евристика «схоже на email» помилилася б і на імені з «@», і на недописаній
   * адресі, а ціна помилки тут — тиха підміна режиму приватності.
   */
  const search = useCallback(async ({ mode: searchMode, value }: SearchQuery): Promise<void> => {
    setSearching(true)

    try {
      const parameter = searchMode === 'name' ? 'q' : 'email'
      const response = await apiRequest(`/users?${parameter}=${encodeURIComponent(value)}`, {
        schema: userSearchResponseSchema,
      })

      setResults(response.results)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setSearching(false)
    }
  }, [])

  /**
   * Одна обгортка на всі дії: гасить попередню помилку, блокує саме ту кнопку, на
   * яку натиснули, і перезавантажує списки. Пошук оновлюється теж — інакше після
   * «Додати в друзі» кнопка в результатах лишається старою й пропонує те саме.
   */
  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setFailure(undefined)
    setBusyKey(key)

    try {
      await action()
      reload()

      if (lastSearch !== undefined) await search(lastSearch)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setBusyKey(undefined)
      setConfirmation(undefined)
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setFailure(undefined)

    // Валідація тією самою схемою, що й на бекенді: вона ж і нормалізує пошту
    // (trim + нижній регістр), тож у запит іде вже нормалізоване значення.
    const result = validate(
      userSearchRequestSchema,
      mode === 'name' ? { q: query } : { email: query },
    )

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})

    const value = mode === 'name' ? (result.data.q ?? '') : (result.data.email ?? '')
    const next: SearchQuery = { mode, value }

    setLastSearch(next)
    void search(next)
  }

  const sendRequest = (userId: string): Promise<void> =>
    run(`request:${userId}`, async () => {
      await apiRequest('/friends/requests', {
        method: 'POST',
        body: { userId },
        schema: friendshipStateResponseSchema,
      })
    })

  const respond = (requestId: string, action: 'accept' | 'decline'): Promise<void> =>
    run(`${action}:${requestId}`, async () => {
      await apiRequest(`/friends/requests/${requestId}`, {
        method: 'PATCH',
        body: { action },
        schema: friendshipStateResponseSchema,
      })
    })

  const removeLink = (userId: string): Promise<void> =>
    run(`remove:${userId}`, async () => {
      await apiRequest(`/friends/${userId}`, { method: 'DELETE' })
    })

  const block = (userId: string): Promise<void> =>
    run(`block:${userId}`, async () => {
      await apiRequest(`/friends/${userId}/block`, { method: 'POST' })
    })

  function confirmRemoveFriend(friend: PublicUser): void {
    setConfirmation({
      title: `Видалити ${friend.displayName} з друзів?`,
      // §5.2 прямо про це каже, і людина мусить знати наслідок ДО натискання.
      description:
        'Активні позичання це не скасує — фізична книжка все одно лишиться в того, у кого вона зараз. Ви більше не бачитимете бібліотеку одне одного.',
      confirmLabel: 'Видалити',
      run: () => removeLink(friend.id),
    })
  }

  function confirmBlock(user: PublicUser): void {
    setConfirmation({
      title: `Заблокувати ${user.displayName}?`,
      description:
        'Ця людина не зможе надсилати вам запити й бачити вашу бібліотеку. Дружбу буде розірвано. Зняти блокування зможете лише ви.',
      confirmLabel: 'Заблокувати',
      run: () => block(user.id),
    })
  }

  function confirmCancelRequest(request: FriendRequest): void {
    setConfirmation({
      title: `Скасувати запит до ${request.user.displayName}?`,
      description: 'Людина більше не побачить його серед вхідних.',
      confirmLabel: 'Скасувати запит',
      run: () => removeLink(request.user.id),
    })
  }

  if (state.status === 'loading') {
    return (
      <Shell>
        <p className="status status--pending">Завантажую друзів…</p>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <FormStatus error={new Error(state.message)} />
        <p className="form__aside">
          <Link href="/">На головну</Link>
        </p>
      </Shell>
    )
  }

  const { friends, incoming, outgoing } = state

  return (
    <Shell>
      <p className="lede">
        Бібліотеки видно лише друзям — з ким ви тут, те й побачите на полицях одне в одного.
      </p>

      <FormStatus error={failure} />

      <Section title="Друзі" count={friends.length}>
        {friends.length === 0 ? (
          <p className="empty">Поки нікого. Знайдіть людей у пошуку нижче.</p>
        ) : (
          <ul className="people">
            {friends.map((friend) => (
              <FriendRow
                key={friend.user.id}
                friend={friend}
                busyKey={busyKey}
                onRemove={() => {
                  confirmRemoveFriend(friend.user)
                }}
                onBlock={() => {
                  confirmBlock(friend.user)
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Вхідні запити" count={incoming.length}>
        {incoming.length === 0 ? (
          <p className="empty">Нових запитів немає.</p>
        ) : (
          <ul className="people">
            {incoming.map((request) => (
              <li className="person" key={request.id}>
                <Person user={request.user} meta={`Запит від ${formatDate(request.createdAt)}`} />
                <div className="person__actions">
                  {/* Прийняти й відхилити — оборотні дії: прийняту дружбу можна
                      розірвати, відхилений запит можна надіслати знову. Підтвердження
                      тут було б зайвим кліком. */}
                  <button
                    type="button"
                    disabled={busyKey !== undefined}
                    onClick={() => void respond(request.id, 'accept')}
                  >
                    {busyKey === `accept:${request.id}` ? 'Приймаю…' : 'Прийняти'}
                  </button>
                  <button
                    type="button"
                    className="button--ghost"
                    disabled={busyKey !== undefined}
                    onClick={() => void respond(request.id, 'decline')}
                  >
                    {busyKey === `decline:${request.id}` ? 'Відхиляю…' : 'Відхилити'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Вихідні запити" count={outgoing.length}>
        {outgoing.length === 0 ? (
          <p className="empty">Ви нікому не надсилали запит.</p>
        ) : (
          <ul className="people">
            {outgoing.map((request) => (
              <li className="person" key={request.id}>
                <Person
                  user={request.user}
                  meta={`Надіслано ${formatDate(request.createdAt)} · чекає на відповідь`}
                />
                <div className="person__actions">
                  <button
                    type="button"
                    className="button--ghost"
                    disabled={busyKey !== undefined}
                    onClick={() => {
                      confirmCancelRequest(request)
                    }}
                  >
                    Скасувати
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Знайти людей">
        <form className="search" onSubmit={submitSearch} noValidate>
          <SelectField
            id="search-mode"
            label="Шукати"
            name="mode"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as SearchMode)
              // Режими шукають різне: результат попереднього тут лише вводив би
              // в оману, бо кнопка «Знайти» ще не натиснута.
              setResults(undefined)
              setErrors({})
            }}
          >
            <option value="name">за імʼям</option>
            <option value="email">за email</option>
          </SelectField>

          <TextField
            id="friend-search"
            label={mode === 'name' ? 'Імʼя людини' : 'Email'}
            name={mode === 'name' ? 'q' : 'email'}
            type={mode === 'name' ? 'text' : 'email'}
            inputMode={mode === 'name' ? 'text' : 'email'}
            autoComplete="off"
            hint={
              mode === 'name'
                ? 'Мінімум два символи, частковий збіг.'
                : 'ТІЛЬКИ точна адреса — підібрати пошту по літері не можна (§6.1).'
            }
            value={query}
            error={errors.q ?? errors.email ?? errors.form}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <button type="submit" disabled={searching}>
            {searching ? 'Шукаю…' : 'Знайти'}
          </button>
        </form>

        {searching && <p className="status status--pending">Шукаю…</p>}

        {!searching && results !== undefined && results.length === 0 && (
          <p className="empty">Нікого не знайдено. Спробуйте іншу частину імені.</p>
        )}

        {!searching && results !== undefined && results.length > 0 && (
          <ul className="people">
            {results.map((result) => (
              <li className="person" key={result.user.id}>
                <Person user={result.user} meta={RELATION_LABELS[result.relation]} />
                <div className="person__actions">
                  <RelationAction
                    result={result}
                    busyKey={busyKey}
                    incoming={incoming}
                    onRequest={() => void sendRequest(result.user.id)}
                    onAccept={(requestId) => void respond(requestId, 'accept')}
                    onUnblock={() => void removeLink(result.user.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ConfirmDialog
        open={confirmation !== undefined}
        title={confirmation?.title ?? ''}
        description={confirmation?.description}
        confirmLabel={confirmation?.confirmLabel ?? 'Підтвердити'}
        pending={busyKey !== undefined}
        onConfirm={() => {
          void confirmation?.run()
        }}
        onCancel={() => {
          setConfirmation(undefined)
        }}
      />

      <p className="form__aside">
        <Link href="/profile">Профіль</Link> · <Link href="/">На головну</Link>
      </p>
    </Shell>
  )
}

const RELATION_LABELS: Record<FriendRelation, string> = {
  NONE: 'Ще не друзі',
  REQUEST_SENT: 'Запит надіслано — чекає на відповідь',
  REQUEST_RECEIVED: 'Надіслав(-ла) вам запит',
  FRIENDS: 'Уже друзі',
  BLOCKED_BY_ME: 'Ви заблокували цю людину',
  BLOCKED_ME: 'Ця людина вас заблокувала',
}

/**
 * Одна кнопка на стан звʼязку.
 *
 * Стан рахує API (`relation`), а не фронт: перетинати списки на клієнті означало б
 * продублювати авторизаційну логіку, ще й без знання про блокування.
 */
function RelationAction({
  result,
  busyKey,
  incoming,
  onRequest,
  onAccept,
  onUnblock,
}: {
  result: UserSearchResult
  busyKey: string | undefined
  incoming: FriendRequest[]
  onRequest: () => void
  onAccept: (requestId: string) => void
  onUnblock: () => void
}) {
  const busy = busyKey !== undefined

  switch (result.relation) {
    case 'NONE':
      return (
        <button type="button" disabled={busy} onClick={onRequest}>
          {busyKey === `request:${result.user.id}` ? 'Надсилаю…' : 'Додати в друзі'}
        </button>
      )
    case 'REQUEST_SENT':
      return (
        <button type="button" disabled>
          Запит надіслано
        </button>
      )
    case 'REQUEST_RECEIVED': {
      const request = incoming.find((item) => item.user.id === result.user.id)

      if (request === undefined) return null

      return (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onAccept(request.id)
          }}
        >
          {busyKey === `accept:${request.id}` ? 'Приймаю…' : 'Прийняти запит'}
        </button>
      )
    }
    case 'FRIENDS':
      return (
        <button type="button" disabled>
          Уже друзі
        </button>
      )
    case 'BLOCKED_BY_ME':
      // Єдиний шлях до розблокування: заблоковані пари не потрапляють ні в список
      // друзів, ні в запити, тож знайти людину можна лише пошуком.
      return (
        <button type="button" className="button--ghost" disabled={busy} onClick={onUnblock}>
          {busyKey === `remove:${result.user.id}` ? 'Знімаю…' : 'Розблокувати'}
        </button>
      )
    case 'BLOCKED_ME':
      return (
        <button type="button" disabled>
          Недоступно
        </button>
      )
  }
}

function FriendRow({
  friend,
  busyKey,
  onRemove,
  onBlock,
}: {
  friend: Friend
  busyKey: string | undefined
  onRemove: () => void
  onBlock: () => void
}) {
  return (
    <li className="person">
      <Person user={friend.user} meta={`Друзі з ${formatDate(friend.friendsSince)}`} />
      <div className="person__actions">
        <button
          type="button"
          className="button--ghost"
          disabled={busyKey !== undefined}
          onClick={onRemove}
        >
          Видалити з друзів
        </button>
        <button
          type="button"
          className="button--ghost"
          disabled={busyKey !== undefined}
          onClick={onBlock}
        >
          Заблокувати
        </button>
      </div>
    </li>
  )
}

function Person({ user, meta }: { user: PublicUser; meta: string }) {
  return (
    <div className="person__who">
      {user.avatarUrl === null ? (
        <span className="avatar avatar--empty" aria-hidden="true">
          {user.displayName.slice(0, 1)}
        </span>
      ) : (
        /* Аватарка — довільний зовнішній URL із профілю (§6.1). `next/image`
           вимагає списку дозволених доменів, а дозволити «будь-який» означало б
           перетворити оптимізатор Next на відкритий проксі для чужих картинок.
           Ціна відмови тут — 40 пікселів без оптимізації. */
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={user.avatarUrl} alt="" width={40} height={40} />
      )}
      <span>
        <span className="person__name">{user.displayName}</span>
        <span className="person__meta">{meta}</span>
      </span>
    </div>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="friends-section">
      <h2>
        {title}
        {count !== undefined && count > 0 && <span className="badge">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

/** ISO з API → коротка дата. Локаль явна: сервер і клієнт мусять збігтися. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
