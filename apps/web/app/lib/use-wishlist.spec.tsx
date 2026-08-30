/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { WishlistItem, Work, WorkAuthor } from '@bookswap/shared'
import type * as ApiModule from './api'
import { useWishlist } from './use-wishlist'

/**
 * Конкурентний прохід над §6.5/§8 (Етап 7f).
 *
 * `wishlist-button.spec.tsx` уже доводить один клік через реальний хук.
 * Тут — race'и: паралельні операції над РІЗНИМИ workId, подвійний виклик
 * одного й того самого workId до ре-рендеру, і розбіжність
 * mutation-failure/reload-failure. Керування завершенням — лише через
 * `Deferred`, без `sleep`.
 */

jest.mock('./api', () => {
  const actual = jest.requireActual<typeof ApiModule>('./api')

  return { ...actual, apiRequest: jest.fn() }
})

const { apiRequest: mockApiRequest } = jest.requireMock<{ apiRequest: jest.Mock }>('./api')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function work(id: string, title: string): Work {
  return {
    id,
    title,
    origLang: 'uk',
    firstPubYear: null,
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

const authors: WorkAuthor[] = [{ id: 'author-1', name: 'Автор', nameLatin: null, role: 'AUTHOR' }]

function item(work0: Work): WishlistItem {
  return {
    id: `item-${work0.id}`,
    workId: work0.id,
    work: work0,
    authors,
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

const workA = work('work-a', 'A')
const workB = work('work-b', 'B')

interface RequestKey {
  method: string
  path: string
  /** POST завжди б'є в один і той самий шлях — розрізняти виклики можна лише за тілом. */
  workId?: string
}

function bodyWorkId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('workId' in body)) return undefined

  const workId = body.workId

  return typeof workId === 'string' ? workId : undefined
}

function key({ method, path, workId }: RequestKey): string {
  return `${method} ${path} ${workId ?? ''}`
}

/**
 * Один спільний мок на весь GET/POST/DELETE-трафік теста. GET завжди відповідає
 * поточним «серверним» станом (`items`, керованим самим тестом); POST/DELETE
 * висять на `Deferred`, який тест звільняє явно — і сам вирішує, чи відбити
 * успіх мутації в `items` до резолву, як робив би справжній сервер.
 */
function setupApi(initialItems: WishlistItem[]) {
  const items = [...initialItems]
  const deferreds = new Map<string, Deferred<void>>()

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') return { items: [...items] }

      const requestKey = key({ method, path, workId: bodyWorkId(options.body) })
      const deferred = createDeferred<void>()

      deferreds.set(requestKey, deferred)
      await deferred.promise

      return undefined
    },
  )

  return {
    items,
    countCalls(requestKey: RequestKey): number {
      return mockApiRequest.mock.calls.filter(
        ([callPath, callOptions]: [string, { method?: string; body?: unknown } | undefined]) => {
          const method = callOptions?.method ?? 'GET'

          if (callPath !== requestKey.path || method !== requestKey.method) return false
          if (requestKey.workId === undefined) return true

          return bodyWorkId(callOptions?.body) === requestKey.workId
        },
      ).length
    },
    resolveMutation(requestKey: RequestKey, applyToServer: () => void): void {
      applyToServer()
      deferreds.get(key(requestKey))?.resolve()
    },
    rejectMutation(requestKey: RequestKey, error: Error): void {
      deferreds.get(key(requestKey))?.reject(error)
    },
  }
}

function addRequest(w: Work): RequestKey {
  return { method: 'POST', path: '/me/wishlist', workId: w.id }
}

function removeRequest(w: Work): RequestKey {
  return { method: 'DELETE', path: `/me/wishlist/${w.id}` }
}

beforeEach(() => {
  mockApiRequest.mockReset()
})

it('remove A + remove B паралельно; B success, A failure → фінально лишається лише A', async () => {
  const api = setupApi([item(workA), item(workB)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workA), item(workB)]))

  act(() => {
    void result.current.remove(workA.id)
    void result.current.remove(workB.id)
  })

  await waitFor(() => expect(result.current.items?.map((i) => i.workId).sort()).toEqual([]))

  api.resolveMutation(removeRequest(workB), () => {
    api.items.splice(
      api.items.findIndex((i) => i.workId === workB.id),
      1,
    )
  })
  api.rejectMutation(removeRequest(workA), new Error('boom'))

  await waitFor(() => expect(result.current.items).toEqual([item(workA)]))
  // Успішно видалений B не воскресає, коли A відкочується.
  expect(result.current.items).toEqual([item(workA)])
})

it('remove A + remove B паралельно; A success, B failure → фінально лишається лише B', async () => {
  const api = setupApi([item(workA), item(workB)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toHaveLength(2))

  act(() => {
    void result.current.remove(workA.id)
    void result.current.remove(workB.id)
  })

  api.resolveMutation(removeRequest(workA), () => {
    api.items.splice(
      api.items.findIndex((i) => i.workId === workA.id),
      1,
    )
  })
  api.rejectMutation(removeRequest(workB), new Error('boom'))

  await waitFor(() => expect(result.current.items).toEqual([item(workB)]))
})

it('add A + add B паралельно; один success, інший failure — незалежні результати', async () => {
  const api = setupApi([])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
    void result.current.add(workB, authors)
  })

  await waitFor(() => expect(result.current.items).toHaveLength(2))

  api.resolveMutation(addRequest(workA), () => {
    api.items.push(item(workA))
  })
  api.rejectMutation(addRequest(workB), new Error('boom'))

  await waitFor(() => {
    expect(result.current.isMember(workA.id)).toBe(true)
    expect(result.current.isMember(workB.id)).toBe(false)
  })
})

it('add A + remove B паралельно — незалежні результати одночасно', async () => {
  const api = setupApi([item(workB)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workB)]))

  act(() => {
    void result.current.add(workA, authors)
    void result.current.remove(workB.id)
  })

  api.resolveMutation(addRequest(workA), () => {
    api.items.push(item(workA))
  })
  api.resolveMutation(removeRequest(workB), () => {
    api.items.splice(
      api.items.findIndex((i) => i.workId === workB.id),
      1,
    )
  })

  await waitFor(() => {
    expect(result.current.isMember(workA.id)).toBe(true)
    expect(result.current.isMember(workB.id)).toBe(false)
  })
})

it('дві різні операції success у зворотному порядку — обидві застосовуються', async () => {
  const api = setupApi([])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
    void result.current.add(workB, authors)
  })

  // B завершується першою, хоч A стартувала першою.
  api.resolveMutation(addRequest(workB), () => {
    api.items.push(item(workB))
  })
  await waitFor(() => expect(result.current.isMember(workB.id)).toBe(true))

  api.resolveMutation(addRequest(workA), () => {
    api.items.push(item(workA))
  })
  await waitFor(() => {
    expect(result.current.isMember(workA.id)).toBe(true)
    expect(result.current.isMember(workB.id)).toBe(true)
  })
})

it('дві різні операції fail у зворотному порядку — обидві відкочуються незалежно', async () => {
  const api = setupApi([item(workA), item(workB)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toHaveLength(2))

  act(() => {
    void result.current.remove(workA.id)
    void result.current.remove(workB.id)
  })

  api.rejectMutation(removeRequest(workB), new Error('boom'))
  await waitFor(() => expect(result.current.isMember(workB.id)).toBe(true))

  api.rejectMutation(removeRequest(workA), new Error('boom'))
  await waitFor(() => {
    expect(result.current.isMember(workA.id)).toBe(true)
    expect(result.current.isMember(workB.id)).toBe(true)
  })
})

it('швидкий подвійний виклик одного workId до ре-рендеру — лише один HTTP-запит', async () => {
  const api = setupApi([])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(api.countCalls(addRequest(workA))).toBeGreaterThan(0))
  expect(api.countCalls(addRequest(workA))).toBe(1)

  api.resolveMutation(addRequest(workA), () => {
    api.items.push(item(workA))
  })
  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(true))
})

it('фоновий reload, спричинений ІНШОЮ операцією, не стирає ще не підтверджену власну mutation', async () => {
  const api = setupApi([item(workA)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workA)]))

  // remove(A) стартує, але DELETE ще висить — операція лишається `pending`.
  act(() => {
    void result.current.remove(workA.id)
  })
  await waitFor(() => expect(result.current.items).toEqual([]))

  // Паралельно add(B) повністю відповідає й запускає СВІЙ reload — фоновий
  // GET, що застає A ще присутньою на сервері (її DELETE ще не завершився).
  act(() => {
    void result.current.add(workB, authors)
  })
  api.resolveMutation(addRequest(workB), () => {
    api.items.push(item(workB))
  })

  await waitFor(() => expect(result.current.isMember(workB.id)).toBe(true))
  // A лишається видаленою локально, хоч щойно прилетів GET, за яким на
  // сервері вона й досі є — її власна mutation ще не завершилась, тож
  // reconciliation не мала права її чіпати.
  expect(result.current.isMember(workA.id)).toBe(false)

  api.resolveMutation(removeRequest(workA), () => {
    api.items.splice(
      api.items.findIndex((i) => i.workId === workA.id),
      1,
    )
  })
  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(false))
})

it('mutation success + confirmation reload failure → committed стан лишається, фонова помилка видима, mutation не показується як провал', async () => {
  let getCallCount = 0

  mockApiRequest.mockImplementation(
    (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        // 1-й GET: початкове завантаження. 2-й: confirmation reload після
        // успішного add(A) — провалюється.
        if (getCallCount === 2) return Promise.reject(new Error('reload failed'))

        return Promise.resolve({ items: [] })
      }

      if (path === '/me/wishlist' && method === 'POST') return Promise.resolve(undefined)

      return Promise.reject(new Error(`no fake response for ${path} ${method}`))
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  // Mutation лишається успішною — жодного action error.
  expect(result.current.actionError).toBeUndefined()
  // UI не повертається до старого (порожнього) стану: A і досі в списку.
  // Реальний `id`/`createdAt` із сервера ще не приїхав — confirmation
  // reload провалився, тож лишається оптимістичний пункт, а не старий
  // порожній знімок.
  expect(result.current.isMember(workA.id)).toBe(true)
  expect(result.current.items?.[0]?.id).toBe(`optimistic:${workA.id}`)
  // `committed` — не `pending`: mutation вже успішна, кнопка не повинна
  // «зависати» на busy-написі, поки летить лише підтвердження.
  expect(result.current.isPending(workA.id)).toBe(false)
})

it('наступний успішний reload узгоджує й прибирає підтверджений overlay після провалу confirmation reload', async () => {
  let getCallCount = 0

  mockApiRequest.mockImplementation(
    (path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        // 1-й GET: початкове завантаження, порожньо.
        // 2-й GET: confirmation reload після успішного add(A) — провалюється.
        // 3-й GET: reload після успішного add(B) — повертає обидва.
        if (getCallCount === 2) return Promise.reject(new Error('reload failed'))

        return Promise.resolve({ items: getCallCount >= 3 ? [item(workA), item(workB)] : [] })
      }

      if (path === '/me/wishlist' && method === 'POST') return Promise.resolve(undefined)

      return Promise.reject(new Error(`no fake response for ${path} ${method}`))
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  expect(result.current.isMember(workA.id)).toBe(true)

  act(() => {
    void result.current.add(workB, authors)
  })

  await waitFor(() => expect(result.current.items).toEqual([item(workA), item(workB)]))
  // Обидва overlay прибрані — джерело правди знову сервер.
  expect(result.current.isPending(workA.id)).toBe(false)
  expect(result.current.isPending(workB.id)).toBe(false)
})

it('провал однієї mutation не прибирає іншу pending операцію', async () => {
  const api = setupApi([item(workA), item(workB)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toHaveLength(2))

  act(() => {
    void result.current.remove(workA.id)
    void result.current.remove(workB.id)
  })

  await waitFor(() => expect(result.current.items).toEqual([]))

  api.rejectMutation(removeRequest(workA), new Error('boom'))

  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(true))
  // B лишається pending (busy), а не відкоченим разом з A.
  expect(result.current.isPending(workB.id)).toBe(true)
  expect(result.current.isMember(workB.id)).toBe(false)
})

it('розмонтування під час mutation/reload не лишає React warning чи висячий проміс', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const api = setupApi([item(workA)])
  const { result, unmount } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workA)]))

  let mutationPromise: Promise<void> | undefined

  act(() => {
    mutationPromise = result.current.remove(workA.id)
  })

  unmount()

  api.resolveMutation(removeRequest(workA), () => {
    api.items.splice(0, 1)
  })

  await expect(mutationPromise).resolves.toBeUndefined()

  expect(errorSpy).not.toHaveBeenCalled()
  errorSpy.mockRestore()
})

/**
 * Другий прохід: `pending` vs `committed` семантика й inverse-дії над
 * `committed`-операцією, що ще не reconciled (confirmation reload провалився
 * навмисно — так само, як у тестах вище, — щоб держати запис у журналі
 * достатньо довго для детермінованого сценарію, а не покладатися на те, чи
 * встиг спрацювати instant-GET із `setupApi`).
 */

it('committed add(A) + невдалий reload → isPending false, isMember true (не busy)', async () => {
  let getCallCount = 0

  mockApiRequest.mockImplementation(
    (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) return Promise.reject(new Error('reload failed'))

        return Promise.resolve({ items: [] })
      }

      if (path === '/me/wishlist' && method === 'POST') return Promise.resolve(undefined)

      return Promise.reject(new Error(`no fake response for ${path} ${method}`))
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  expect(result.current.isPending(workA.id)).toBe(false)
  expect(result.current.isMember(workA.id)).toBe(true)
})

it('committed remove(A) + невдалий reload → isPending false, isMember false (не busy)', async () => {
  let getCallCount = 0

  mockApiRequest.mockImplementation(
    (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) return Promise.reject(new Error('reload failed'))

        return Promise.resolve({ items: [item(workA)] })
      }

      if (path === `/me/wishlist/${workA.id}` && method === 'DELETE')
        return Promise.resolve(undefined)

      return Promise.reject(new Error(`no fake response for ${path} ${method}`))
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workA)]))

  act(() => {
    void result.current.remove(workA.id)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  expect(result.current.isPending(workA.id)).toBe(false)
  expect(result.current.isMember(workA.id)).toBe(false)
})

it('committed add(A) → inverse remove(A) успішний — фінальний стан відповідає remove', async () => {
  const api = setupApi([])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })
  api.resolveMutation(addRequest(workA), () => {
    api.items.push(item(workA))
  })
  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(true))
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(false))

  act(() => {
    void result.current.remove(workA.id)
  })
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(true))

  api.resolveMutation(removeRequest(workA), () => {
    api.items.splice(
      api.items.findIndex((entry) => entry.workId === workA.id),
      1,
    )
  })

  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(false))
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(false))
  expect(result.current.actionError).toBeUndefined()
})

it('committed remove(A) → inverse add(A) успішний — фінальний стан відповідає add', async () => {
  const api = setupApi([item(workA)])
  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workA)]))

  act(() => {
    void result.current.remove(workA.id)
  })
  api.resolveMutation(removeRequest(workA), () => {
    api.items.splice(
      api.items.findIndex((entry) => entry.workId === workA.id),
      1,
    )
  })
  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(false))
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(false))

  act(() => {
    void result.current.add(workA, authors)
  })
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(true))

  api.resolveMutation(addRequest(workA), () => {
    api.items.push(item(workA))
  })

  await waitFor(() => expect(result.current.isMember(workA.id)).toBe(true))
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(false))
  expect(result.current.actionError).toBeUndefined()
})

it('committed add(A), НЕ reconciled → inverse remove(A) провалюється → відновлюється committed add(A), а не голий стан', async () => {
  let getCallCount = 0
  const deleteGate = createDeferred<void>()

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) throw new Error('reload failed')

        return { items: [] }
      }

      if (path === '/me/wishlist' && method === 'POST') return undefined

      if (path === `/me/wishlist/${workA.id}` && method === 'DELETE') {
        await deleteGate.promise
        throw new Error('remove failed')
      }

      throw new Error(`no fake response for ${path} ${method}`)
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  // committed, НЕ reconciled: confirmation reload провалився навмисно — саме
  // цей стан і є предметом тесту.
  expect(result.current.isMember(workA.id)).toBe(true)
  expect(result.current.isPending(workA.id)).toBe(false)

  act(() => {
    void result.current.remove(workA.id)
  })

  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(true))
  expect(result.current.isMember(workA.id)).toBe(false)

  deleteGate.resolve()

  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(false))
  // Відновлено ПОПЕРЕДНІЙ committed add(A) — A знову в списку. Звичайне
  // «просто прибрати запис» показало б голий (порожній) серверний знімок —
  // саме тут ламався б наївний `rollbackOperation`.
  expect(result.current.isMember(workA.id)).toBe(true)
  expect(result.current.actionError).toBeDefined()
})

it('committed remove(A), НЕ reconciled → inverse add(A) провалюється → відновлюється committed remove(A), а не голий стан', async () => {
  let getCallCount = 0
  const postGate = createDeferred<void>()

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) throw new Error('reload failed')

        return { items: [item(workA)] }
      }

      if (path === `/me/wishlist/${workA.id}` && method === 'DELETE') return undefined

      if (path === '/me/wishlist' && method === 'POST') {
        await postGate.promise
        throw new Error('add failed')
      }

      throw new Error(`no fake response for ${path} ${method}`)
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([item(workA)]))

  act(() => {
    void result.current.remove(workA.id)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  expect(result.current.isMember(workA.id)).toBe(false)
  expect(result.current.isPending(workA.id)).toBe(false)

  act(() => {
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(true))
  expect(result.current.isMember(workA.id)).toBe(true)

  postGate.resolve()

  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(false))
  // Відновлено ПОПЕРЕДНІЙ committed remove(A) — A знову відсутній.
  expect(result.current.isMember(workA.id)).toBe(false)
  expect(result.current.actionError).toBeDefined()
})

it('застарілий reload попередньої committed-версії завершується під час нової inverse pending — не чіпає її', async () => {
  const items: WishlistItem[] = []
  const getGates: Deferred<{ items: WishlistItem[] }>[] = []
  // DELETE навмисно висить: тест перевіряє стан ПОКИ remove(A) `pending`, тож
  // її власний HTTP не повинен встигнути відповісти сам по собі.
  const deleteGate = createDeferred<void>()

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        const gate = createDeferred<{ items: WishlistItem[] }>()

        getGates.push(gate)

        return gate.promise
      }

      if (path === '/me/wishlist' && method === 'POST') return undefined

      if (path === `/me/wishlist/${workA.id}` && method === 'DELETE') {
        await deleteGate.promise

        return undefined
      }

      throw new Error(`no fake response for ${path} ${method}`)
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(getGates).toHaveLength(1))
  getGates[0]?.resolve({ items: [...items] })
  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })

  // POST не deferred (резолвиться миттєво) → mutate() комітить add(A) і сам
  // стартує confirmation reload — 2-й GET, який НАВМИСНО тримаємо висячим.
  await waitFor(() => expect(getGates).toHaveLength(2))
  expect(result.current.isMember(workA.id)).toBe(true)
  expect(result.current.isPending(workA.id)).toBe(false)

  // Користувач передумує ДО того, як застарілий reload встиг відповісти:
  // committed add(A) заміняється на pending remove(A) (з `previous` —
  // committed add(A)).
  act(() => {
    void result.current.remove(workA.id)
  })
  await waitFor(() => expect(result.current.isPending(workA.id)).toBe(true))
  expect(result.current.isMember(workA.id)).toBe(false)

  // Тепер звільняємо ЗАСТАРІЛИЙ reload від add(A): на момент його старту
  // сервер іще не бачив A, тож відповідь — порожній список. Жодної НОВОЇ
  // generation (`reload()`) від remove(A) ще не було — це й досі
  // «поточне» покоління `useApiResource`, тож відповідь таки стає
  // `state.data`. Захищає саме `pending`-імунітет reconciliation: значення
  // застарілого GET неважливе, бо операція для work-a вже не `committed`.
  getGates[1]?.resolve({ items: [...items] })

  await waitFor(() => expect(getGates).toHaveLength(2))
  expect(result.current.isPending(workA.id)).toBe(true)
  expect(result.current.isMember(workA.id)).toBe(false)
})

it('дублікат тієї самої дії, поки committed ще не reconciled — без зайвого HTTP', async () => {
  let getCallCount = 0

  function countPostCalls(): number {
    return mockApiRequest.mock.calls.filter(
      ([path, options]: [string, { method?: string } | undefined]) =>
        path === '/me/wishlist' && (options?.method ?? 'GET') === 'POST',
    ).length
  }

  mockApiRequest.mockImplementation(
    (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) return Promise.reject(new Error('reload failed'))

        return Promise.resolve({ items: [] })
      }

      if (path === '/me/wishlist' && method === 'POST') return Promise.resolve(undefined)

      return Promise.reject(new Error(`no fake response for ${path} ${method}`))
    },
  )

  const { result } = renderHook(() => useWishlist())

  await waitFor(() => expect(result.current.items).toEqual([]))

  act(() => {
    void result.current.add(workA, authors)
  })

  await waitFor(() => expect(result.current.backgroundErrorMessage).toBeDefined())
  // committed, НЕ reconciled — саме стан, у якому дублікат мусить відмовити.
  expect(result.current.isMember(workA.id)).toBe(true)

  const callsBefore = countPostCalls()

  act(() => {
    void result.current.add(workA, authors)
  })

  expect(countPostCalls()).toBe(callsBefore)
})

it('розмонтування під час CONFIRMATION reload (не самої mutation) — без warning, без висячого reload waiter', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const getGates: Deferred<{ items: WishlistItem[] }>[] = []

  mockApiRequest.mockImplementation(
    (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        const gate = createDeferred<{ items: WishlistItem[] }>()

        getGates.push(gate)

        return gate.promise
      }

      if (path === '/me/wishlist' && method === 'POST') return Promise.resolve(undefined)

      return Promise.reject(new Error(`no fake response for ${path} ${method}`))
    },
  )

  const { result, unmount } = renderHook(() => useWishlist())

  await waitFor(() => expect(getGates).toHaveLength(1))
  getGates[0]?.resolve({ items: [] })
  await waitFor(() => expect(result.current.items).toEqual([]))

  let mutationPromise: Promise<void> | undefined

  act(() => {
    mutationPromise = result.current.add(workA, authors)
  })

  // Mutation (POST) сама по собі не deferred — резолвиться миттєво. Комітить
  // і стартує confirmation reload: 2-й GET, який тримаємо висячим саме до
  // моменту розмонтування.
  await waitFor(() => expect(getGates).toHaveLength(2))

  unmount()

  // GET завершується вже ПІСЛЯ розмонтування — вправляє і `load()`'s
  // `aborted`-guard у `use-resource.ts`, і звільнення waiter'ів на
  // розмонтуванні.
  getGates[1]?.resolve({ items: [item(workA)] })

  await expect(mutationPromise).resolves.toBeUndefined()
  expect(errorSpy).not.toHaveBeenCalled()
  errorSpy.mockRestore()
})
