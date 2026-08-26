import type { FormEvent } from 'react'
import type { FriendRelation, FriendRequest, UserSearchResult } from '@bookswap/shared'
import { SearchIcon, UserPlusIcon } from 'lucide-react'
import type { FieldErrors } from '@/app/lib/validation'
import { UserAvatar } from '@/components/Friends/UserAvatar'
import { Button } from '@/components/ui/button'

export type SearchMode = 'name' | 'email'

const RELATION_LABELS: Record<FriendRelation, string> = {
  NONE: 'Ще не друзі',
  REQUEST_SENT: 'Запит надіслано — чекає на відповідь',
  REQUEST_RECEIVED: 'Надіслав(-ла) вам запит',
  FRIENDS: 'Уже друзі',
  BLOCKED_BY_ME: 'Ви заблокували цю людину',
  BLOCKED_ME: 'Ця людина вас заблокувала',
}

interface FriendsSearchProps {
  mode: SearchMode
  query: string
  results: UserSearchResult[] | undefined
  searching: boolean
  errors: FieldErrors
  busyKey: string | undefined
  incoming: FriendRequest[]
  onModeChange: (mode: SearchMode) => void
  onQueryChange: (query: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRequest: (userId: string) => void
  onAccept: (requestId: string) => void
  onUnblock: (userId: string) => void
}

function FriendsSearch({
  mode,
  query,
  results,
  searching,
  errors,
  busyKey,
  incoming,
  onModeChange,
  onQueryChange,
  onSubmit,
  onRequest,
  onAccept,
  onUnblock,
}: FriendsSearchProps) {
  const error = errors.q ?? errors.email ?? errors.form
  const hintId = 'friend-search-hint'
  const errorId = 'friend-search-error'

  return (
    <section className="space-y-4" aria-labelledby="friend-search-title">
      <div>
        <h2 id="friend-search-title" className="text-lg font-semibold">
          Знайти людей
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ім’я можна вводити частково, email має збігатися повністю.
        </p>
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit} noValidate>
        <label className="sr-only" htmlFor="friend-search-mode">
          Спосіб пошуку
        </label>
        <select
          id="friend-search-mode"
          className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-36"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as SearchMode)}
        >
          <option value="name">За ім’ям</option>
          <option value="email">За email</option>
        </select>

        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="friend-search">
            {mode === 'name' ? 'Ім’я людини' : 'Email людини'}
          </label>
          <input
            id="friend-search"
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
            name={mode === 'name' ? 'q' : 'email'}
            type={mode === 'name' ? 'search' : 'email'}
            inputMode={mode === 'name' ? 'search' : 'email'}
            autoComplete="off"
            placeholder={mode === 'name' ? 'Введіть ім’я' : 'name@example.com'}
            value={query}
            aria-invalid={error !== undefined || undefined}
            aria-describedby={`${hintId}${error === undefined ? '' : ` ${errorId}`}`}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>

        <Button type="submit" size="lg" disabled={searching}>
          <SearchIcon aria-hidden="true" />
          {searching ? 'Шукаю…' : 'Знайти'}
        </Button>
      </form>

      <p id={hintId} className="sr-only">
        {mode === 'name' ? 'Введіть щонайменше два символи.' : 'Потрібна повна точна email-адреса.'}
      </p>
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {searching && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Шукаю людей…
        </p>
      )}

      {!searching && results !== undefined && results.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Нікого не знайдено. Спробуйте інше ім’я або перевірте email.
        </p>
      )}

      {!searching && results !== undefined && results.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card text-card-foreground">
          {results.map((result) => (
            <li key={result.user.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
              <UserAvatar user={result.user} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{result.user.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {RELATION_LABELS[result.relation]}
                </p>
              </div>
              <RelationAction
                result={result}
                requestId={incoming.find((item) => item.user.id === result.user.id)?.id}
                busyKey={busyKey}
                onRequest={onRequest}
                onAccept={onAccept}
                onUnblock={onUnblock}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RelationAction({
  result,
  requestId,
  busyKey,
  onRequest,
  onAccept,
  onUnblock,
}: {
  result: UserSearchResult
  requestId: string | undefined
  busyKey: string | undefined
  onRequest: (userId: string) => void
  onAccept: (requestId: string) => void
  onUnblock: (userId: string) => void
}) {
  const busy = busyKey !== undefined

  switch (result.relation) {
    case 'NONE':
      return (
        <Button type="button" size="sm" disabled={busy} onClick={() => onRequest(result.user.id)}>
          <UserPlusIcon aria-hidden="true" />
          {busyKey === `request:${result.user.id}` ? 'Надсилаю…' : 'Додати'}
        </Button>
      )
    case 'REQUEST_RECEIVED':
      return requestId === undefined ? null : (
        <Button type="button" size="sm" disabled={busy} onClick={() => onAccept(requestId)}>
          Прийняти
        </Button>
      )
    case 'BLOCKED_BY_ME':
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onUnblock(result.user.id)}
        >
          {busyKey === `remove:${result.user.id}` ? 'Знімаю…' : 'Розблокувати'}
        </Button>
      )
    case 'REQUEST_SENT':
    case 'FRIENDS':
    case 'BLOCKED_ME':
      return null
  }
}

export { FriendsSearch }
