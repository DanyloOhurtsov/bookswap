'use client'

import Link from 'next/link'
import { ArrowLeftIcon, SearchIcon } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { IoPeopleOutline, IoPersonAdd } from 'react-icons/io5'
import {
  friendshipStateResponseSchema,
  userSearchRequestSchema,
  userSearchResponseSchema,
  type FriendRelation,
  type PublicUser,
  type UserSearchResult,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { useFriends } from '@/app/lib/use-friends'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/Friends/UserAvatar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'

type View = 'friends' | 'search'

const RELATION_LABELS: Record<FriendRelation, string> = {
  NONE: 'Ще не друзі',
  REQUEST_SENT: 'Запит уже надіслано',
  REQUEST_RECEIVED: 'Надіслав(-ла) вам запит',
  FRIENDS: 'Уже у ваших друзях',
  BLOCKED_BY_ME: 'Ви заблокували цю людину',
  BLOCKED_ME: 'Цей профіль недоступний',
}

export const NavBarFriends = () => {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Відкрити список друзів">
            <IoPeopleOutline aria-hidden="true" />
          </Button>
        }
      />

      {open && <FriendsPanel onNavigate={() => setOpen(false)} />}
    </Sheet>
  )
}

function FriendsPanel({ onNavigate }: { onNavigate: () => void }) {
  const friends = useFriends()
  const [view, setView] = useState<View>('friends')
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState<string>()
  const [results, setResults] = useState<UserSearchResult[]>()
  const [searching, setSearching] = useState(false)
  const [busyKey, setBusyKey] = useState<string>()
  const [failure, setFailure] = useState<string>()

  const search = useCallback(async (rawQuery: string): Promise<void> => {
    const value = rawQuery.trim()
    const nameQuery = userSearchRequestSchema.safeParse({ q: value })
    const emailQuery = userSearchRequestSchema.safeParse({ email: value })

    if (!nameQuery.success && !emailQuery.success) {
      setFailure('Введіть щонайменше два символи або повну email-адресу.')
      setResults(undefined)
      return
    }

    setFailure(undefined)
    setSearching(true)

    try {
      const requests: Promise<{ results: UserSearchResult[] }>[] = []

      if (nameQuery.success && nameQuery.data.q !== undefined) {
        requests.push(
          apiRequest(`/users?q=${encodeURIComponent(nameQuery.data.q)}`, {
            schema: userSearchResponseSchema,
          }),
        )
      }

      // Email API шукає лише точний збіг. Для повної валідної адреси запити за
      // ім'ям та email виконуються паралельно, а результати дедуплікуються.
      if (emailQuery.success && emailQuery.data.email !== undefined) {
        requests.push(
          apiRequest(`/users?email=${encodeURIComponent(emailQuery.data.email)}`, {
            schema: userSearchResponseSchema,
          }),
        )
      }

      const responses = await Promise.all(requests)
      const unique = new Map<string, UserSearchResult>()

      for (const response of responses) {
        for (const result of response.results) unique.set(result.user.id, result)
      }

      setResults([...unique.values()])
      setLastQuery(value)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : describeError(error))
    } finally {
      setSearching(false)
    }
  }, [])

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    setFailure(undefined)
    setBusyKey(key)

    try {
      await action()
      friends.reload()

      if (lastQuery !== undefined) await search(lastQuery)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : describeError(error))
    } finally {
      setBusyKey(undefined)
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void search(query)
  }

  function sendRequest(userId: string): void {
    void run(`request:${userId}`, () =>
      apiRequest('/friends/requests', {
        method: 'POST',
        body: { userId },
        schema: friendshipStateResponseSchema,
      }),
    )
  }

  function acceptRequest(requestId: string): void {
    void run(`accept:${requestId}`, () =>
      apiRequest(`/friends/requests/${requestId}`, {
        method: 'PATCH',
        body: { action: 'accept' },
        schema: friendshipStateResponseSchema,
      }),
    )
  }

  return (
    <SheetContent className="dark w-full gap-0 sm:max-w-md">
      <SheetHeader className="border-b pr-14">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SheetTitle>{view === 'friends' ? 'Друзі' : 'Знайти друзів'}</SheetTitle>
            <SheetDescription>
              {view === 'friends'
                ? 'Ваші поточні друзі та їхні бібліотеки.'
                : 'Пошук за іменем або повною email-адресою.'}
            </SheetDescription>
          </div>

          {view === 'friends' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Знайти нового друга"
              onClick={() => setView('search')}
            >
              <IoPersonAdd aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Повернутися до списку друзів"
              onClick={() => setView('friends')}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {failure !== undefined && (
          <p
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
            role="alert"
          >
            {failure}
          </p>
        )}

        {view === 'friends' ? (
          <FriendsList state={friends.state} onNavigate={onNavigate} />
        ) : (
          <SearchView
            query={query}
            results={results}
            searching={searching}
            busyKey={busyKey}
            incoming={friends.state.status === 'ready' ? friends.state.incoming : []}
            onQueryChange={setQuery}
            onSubmit={submitSearch}
            onRequest={sendRequest}
            onAccept={acceptRequest}
          />
        )}
      </div>

      <div className="border-t p-4">
        <Link href="/friends" className="text-sm font-medium" onClick={onNavigate}>
          Відкрити сторінку друзів
        </Link>
      </div>
    </SheetContent>
  )
}

function FriendsList({
  state,
  onNavigate,
}: {
  state: ReturnType<typeof useFriends>['state']
  onNavigate: () => void
}) {
  if (state.status === 'loading') {
    return (
      <div className="space-y-3" aria-label="Завантажую друзів">
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return <p className="text-sm text-destructive">{state.message}</p>
  }

  if (state.friends.length === 0) {
    return <p className="text-sm text-muted-foreground">Поки що у вас немає друзів.</p>
  }

  return (
    <ul className="space-y-2">
      {state.friends.map((friend) => (
        <li key={friend.user.id}>
          <Link
            href={`/users/${friend.user.id}/library`}
            className="flex items-center gap-3 rounded-lg p-2 text-inherit no-underline hover:bg-muted"
            onClick={onNavigate}
          >
            <UserAvatar user={friend.user} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{friend.user.displayName}</span>
              <span className="block text-xs text-muted-foreground">Переглянути бібліотеку</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function SearchView({
  query,
  results,
  searching,
  busyKey,
  incoming,
  onQueryChange,
  onSubmit,
  onRequest,
  onAccept,
}: {
  query: string
  results: UserSearchResult[] | undefined
  searching: boolean
  busyKey: string | undefined
  incoming: { id: string; user: PublicUser }[]
  onQueryChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRequest: (userId: string) => void
  onAccept: (requestId: string) => void
}) {
  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={onSubmit} noValidate>
        <label className="sr-only" htmlFor="navbar-friend-search">
          Імʼя або email
        </label>
        <input
          id="navbar-friend-search"
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          type="search"
          autoComplete="off"
          placeholder="Ім’я або повний email"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <Button type="submit" size="icon" disabled={searching} aria-label="Шукати друзів">
          <SearchIcon aria-hidden="true" />
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Ім’я можна вводити частково. Email має збігатися повністю.
      </p>

      {searching && <SearchSkeleton />}

      {!searching && results !== undefined && results.length === 0 && (
        <p className="text-sm text-muted-foreground">Нікого не знайдено.</p>
      )}

      {!searching && results !== undefined && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((result) => {
            const request = incoming.find((item) => item.user.id === result.user.id)

            return (
              <li key={result.user.id} className="flex items-center gap-3 rounded-lg border p-3">
                <UserAvatar user={result.user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{result.user.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {RELATION_LABELS[result.relation]}
                  </p>
                </div>
                <SearchResultAction
                  result={result}
                  requestId={request?.id}
                  busyKey={busyKey}
                  onRequest={onRequest}
                  onAccept={onAccept}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SearchResultAction({
  result,
  requestId,
  busyKey,
  onRequest,
  onAccept,
}: {
  result: UserSearchResult
  requestId: string | undefined
  busyKey: string | undefined
  onRequest: (userId: string) => void
  onAccept: (requestId: string) => void
}) {
  const busy = busyKey !== undefined

  switch (result.relation) {
    case 'NONE':
      return (
        <Button type="button" size="sm" disabled={busy} onClick={() => onRequest(result.user.id)}>
          {busyKey === `request:${result.user.id}` ? 'Надсилаю…' : 'Додати'}
        </Button>
      )
    case 'REQUEST_RECEIVED':
      return requestId === undefined ? null : (
        <Button type="button" size="sm" disabled={busy} onClick={() => onAccept(requestId)}>
          {busyKey === `accept:${requestId}` ? 'Приймаю…' : 'Прийняти'}
        </Button>
      )
    case 'REQUEST_SENT':
    case 'FRIENDS':
    case 'BLOCKED_BY_ME':
    case 'BLOCKED_ME':
      return null
  }
}

function SearchSkeleton() {
  return (
    <div className="space-y-3" aria-label="Шукаю друзів">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      ))}
    </div>
  )
}
