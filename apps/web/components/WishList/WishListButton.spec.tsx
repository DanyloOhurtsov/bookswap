/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { WishlistItem, Work, WorkAuthor } from '@bookswap/shared'
import * as api from '@/app/lib/api'
import { useWishlist } from '@/app/lib/use-wishlist'
import { WishlistButton } from '@/components/WishList/WishListButton'

/**
 * Етап 7f, DoD: «оптимістичне оновлення відкочується при помилці».
 *
 * `apiRequest` підміняється через `jest.spyOn`, тому `ApiRequestError` і
 * `describeError` лишаються справжніми: саме за ними хук вирішує, яке
 * повідомлення показати. `useWishlist` тут справжній: перевіряється не сама
 * кнопка окремо, а зв'язка «клік → одразу видно зміну → відповідь сервера»
 * разом із хуком, який цю зміну й відкочує.
 *
 * Мітки: `member` уже відображає ОПТИМІСТИЧНУ ціль mutation, що летить —
 * `busy && member` це щойно доданий (ще не підтверджений) рядок, тобто
 * «Додаю…»; `busy && !member` — щойно прибраний, тобто «Прибираю…».
 * `WishlistButton` саме так і мапить `busy`/`member` на напис.
 */
const mockApiRequest = jest.spyOn(api, 'apiRequest')

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

const work: Work = {
  id: 'work-1',
  title: 'Кобзар',
  origLang: 'uk',
  firstPubYear: 1840,
  description: null,
  createdAt: '2024-01-01T00:00:00.000Z',
}

const authors: WorkAuthor[] = [
  { id: 'author-1', name: 'Тарас Шевченко', nameLatin: null, role: 'AUTHOR' },
]

function Harness() {
  const wishlist = useWishlist()

  return <WishlistButton work={work} authors={authors} wishlist={wishlist} />
}

beforeEach(() => {
  mockApiRequest.mockReset()
})

function item(): WishlistItem {
  return { id: 'item-1', workId: work.id, work, authors, createdAt: '2024-06-01T00:00:00.000Z' }
}

it('початковий add: поки POST висить — заблокована «Додаю…»; після успіху — активна «Прибрати з вішлиста»', async () => {
  const user = userEvent.setup()
  const store: WishlistItem[] = []
  let resolvePost: () => void = () => undefined

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') return { items: [...store] }

      if (path === '/me/wishlist' && method === 'POST') {
        return new Promise((resolve) => {
          resolvePost = () => {
            store.push(item())
            resolve(undefined)
          }
        })
      }

      throw new Error(`Немає фейкової відповіді для ${path} ${method}`)
    },
  )

  render(<Harness />)

  const addButton = await screen.findByRole('button', { name: 'Додати у вішлист' })
  await user.click(addButton)

  // Оптимістично: member уже true (рядок з'явився б у списку), POST ще
  // летить — саме тому напис «Додаю…», а не «Прибрати з вішлиста».
  const pendingButton = await screen.findByRole('button', { name: 'Додаю…' })

  expect(pendingButton).toBeDisabled()

  resolvePost()

  // Після успіху й фонового reload() лишається той самий стан, уже не busy —
  // тепер уже за справжніми даними сервера, а не за оптимістичним оверлеєм.
  const resolvedButton = await screen.findByRole('button', { name: 'Прибрати з вішлиста' })

  expect(resolvedButton).not.toBeDisabled()
})

it('add провалюється — відкат до «Додати у вішлист» і повідомлення про помилку', async () => {
  const user = userEvent.setup()
  let rejectPost: (error: Error) => void = () => undefined

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') return { items: [] }

      if (path === '/me/wishlist' && method === 'POST') {
        return new Promise((_, reject) => {
          rejectPost = reject
        })
      }

      throw new Error(`Немає фейкової відповіді для ${path} ${method}`)
    },
  )

  render(<Harness />)

  const addButton = await screen.findByRole('button', { name: 'Додати у вішлист' })
  await user.click(addButton)

  // Оптимістично: видно зміну одразу, POST ще летить.
  await screen.findByRole('button', { name: 'Додаю…' })

  rejectPost(new Error('boom'))

  // Сервер відмовив — відкат до попереднього стану й повідомлення про помилку.
  await screen.findByRole('button', { name: 'Додати у вішлист' })
  await screen.findByText(/Не вдалося звʼязатися з API/)
})

/**
 * Другий прохід: `committed` — не `pending`. Mutation уже успішна, кнопка не
 * повинна «зависати» на busy-написі, поки летить лише фонове підтвердження
 * (`GET`), яке тут навмисно провалюється.
 */
it('committed add + невдалий confirmation reload → кнопка показує «Прибрати з вішлиста», не busy', async () => {
  const user = userEvent.setup()
  let getCallCount = 0
  let resolvePost: () => void = () => undefined

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        // 1-й GET: початкове завантаження. 2-й: confirmation reload після
        // успішного POST — навмисно провалюється.
        if (getCallCount === 2) throw new Error('reload failed')

        return { items: [] }
      }

      if (path === '/me/wishlist' && method === 'POST') {
        return new Promise((resolve) => {
          resolvePost = () => resolve(undefined)
        })
      }

      throw new Error(`Немає фейкової відповіді для ${path} ${method}`)
    },
  )

  render(<Harness />)

  const addButton = await screen.findByRole('button', { name: 'Додати у вішлист' })
  await user.click(addButton)

  const pendingButton = await screen.findByRole('button', { name: 'Додаю…' })

  expect(pendingButton).toBeDisabled()

  resolvePost()

  // Mutation успішна (committed), confirmation reload провалюється — кнопка
  // показує РЕЗУЛЬТАТ дії, а не висить на busy-написі.
  const resolvedButton = await screen.findByRole('button', { name: 'Прибрати з вішлиста' })

  expect(resolvedButton).not.toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Додаю…' })).not.toBeInTheDocument()
})

it('committed remove + невдалий confirmation reload → кнопка показує «Додати у вішлист», не busy', async () => {
  const user = userEvent.setup()
  const store: WishlistItem[] = [item()]
  let getCallCount = 0
  let resolveDelete: () => void = () => undefined

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) throw new Error('reload failed')

        return { items: [...store] }
      }

      if (path === `/me/wishlist/${work.id}` && method === 'DELETE') {
        return new Promise((resolve) => {
          resolveDelete = () => {
            store.splice(0, store.length)
            resolve(undefined)
          }
        })
      }

      throw new Error(`Немає фейкової відповіді для ${path} ${method}`)
    },
  )

  render(<Harness />)

  const removeButton = await screen.findByRole('button', { name: 'Прибрати з вішлиста' })
  await user.click(removeButton)

  // Оптимістично member стає false одразу — рядок щойно «зник», тож напис
  // «Прибираю…».
  const pendingButton = await screen.findByRole('button', { name: 'Прибираю…' })

  expect(pendingButton).toBeDisabled()

  resolveDelete()

  const resolvedButton = await screen.findByRole('button', { name: 'Додати у вішлист' })

  expect(resolvedButton).not.toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Прибираю…' })).not.toBeInTheDocument()
})

/**
 * Третій прохід: inverse-дія над `committed`, ще не reconciled (confirmation
 * reload навмисно провалений — так само, як вище). HTTP inverse-дії тримаємо
 * на `Deferred`, щоб перевірити СПРАВЖНЮ pending-фазу, а не кінцевий стан.
 */
it('committed add після невдалого reload → inverse remove pending → «Прибираю…», заблокована', async () => {
  const user = userEvent.setup()
  let getCallCount = 0
  let resolvePost: () => void = () => undefined
  const deleteGate = createDeferred<void>()

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) throw new Error('reload failed')

        return { items: [] }
      }

      if (path === '/me/wishlist' && method === 'POST') {
        return new Promise((resolve) => {
          resolvePost = () => resolve(undefined)
        })
      }

      if (path === `/me/wishlist/${work.id}` && method === 'DELETE') {
        await deleteGate.promise

        return undefined
      }

      throw new Error(`Немає фейкової відповіді для ${path} ${method}`)
    },
  )

  render(<Harness />)

  const addButton = await screen.findByRole('button', { name: 'Додати у вішлист' })
  await user.click(addButton)

  resolvePost()

  // committed add(A), НЕ reconciled — confirmation reload провалився.
  const committedButton = await screen.findByRole('button', { name: 'Прибрати з вішлиста' })

  await user.click(committedButton)

  // Inverse remove(A) стартувала, DELETE ще висить на `deleteGate` — саме
  // ПІД ЧАС цього pending-вікна кнопка мусить показувати «Прибираю…».
  const pendingButton = await screen.findByRole('button', { name: 'Прибираю…' })

  expect(pendingButton).toBeDisabled()
})

it('committed remove після невдалого reload → inverse add pending → «Додаю…», заблокована', async () => {
  const user = userEvent.setup()
  const store: WishlistItem[] = [item()]
  let getCallCount = 0
  let resolveDelete: () => void = () => undefined
  const postGate = createDeferred<void>()

  mockApiRequest.mockImplementation(
    async (path: string, options: { method?: string } = {}): Promise<unknown> => {
      const method = options.method ?? 'GET'

      if (path === '/me/wishlist' && method === 'GET') {
        getCallCount += 1
        if (getCallCount === 2) throw new Error('reload failed')

        return { items: [...store] }
      }

      if (path === `/me/wishlist/${work.id}` && method === 'DELETE') {
        return new Promise((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
      }

      if (path === '/me/wishlist' && method === 'POST') {
        await postGate.promise

        return undefined
      }

      throw new Error(`Немає фейкової відповіді для ${path} ${method}`)
    },
  )

  render(<Harness />)

  const removeButton = await screen.findByRole('button', { name: 'Прибрати з вішлиста' })
  await user.click(removeButton)

  resolveDelete()

  // committed remove(A), НЕ reconciled — confirmation reload провалився.
  const committedButton = await screen.findByRole('button', { name: 'Додати у вішлист' })

  await user.click(committedButton)

  // Inverse add(A) стартувала, POST ще висить на `postGate` — саме ПІД ЧАС
  // цього pending-вікна кнопка мусить показувати «Додаю…».
  const pendingButton = await screen.findByRole('button', { name: 'Додаю…' })

  expect(pendingButton).toBeDisabled()
})
