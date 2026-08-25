/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { WishlistItem, Work, WorkAuthor } from '@bookswap/shared'
import { useWishlist } from '../lib/use-wishlist'
import { WishlistButton } from './wishlist-button'

/**
 * Етап 7f, DoD: «оптимістичне оновлення відкочується при помилці».
 *
 * `apiRequest` мокається цілим модулем — `ApiRequestError`/`describeError`
 * лишаються справжніми, бо саме за ними хук вирішує, яке повідомлення
 * показати. `useWishlist` тут справжній: перевіряється не сама кнопка окремо,
 * а зв'язка «клік → одразу видно зміну → відповідь сервера» разом із хуком,
 * який цю зміну й відкочує.
 */
jest.mock('../lib/api', () => {
  const actual = jest.requireActual<typeof import('../lib/api')>('../lib/api')

  return { ...actual, apiRequest: jest.fn() }
})

const { apiRequest: mockApiRequest } = jest.requireMock<{ apiRequest: jest.Mock }>('../lib/api')

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

it('оптимістично перемикається на «Прибрати», не чекаючи відповіді сервера, і залишається так після успіху', async () => {
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

  // Оптимістично: перемикається на «прибрати», не чекаючи POST, — саме
  // тому кнопка вже заблокована написом «Прибираю…», а не «Прибрати з
  // вішлиста»: членство вже враховане, летить лише підтвердження сервера.
  await screen.findByRole('button', { name: 'Прибираю…' })

  resolvePost()

  // Після успіху й фонового reload() лишається той самий стан, уже не busy —
  // тепер уже за справжніми даними сервера, а не за оптимістичним оверлеєм.
  await screen.findByRole('button', { name: 'Прибрати з вішлиста' })
})

it('відкочує оптимістичну зміну і показує помилку, якщо сервер відмовив', async () => {
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
  await screen.findByRole('button', { name: 'Прибираю…' })

  rejectPost(new Error('boom'))

  // Сервер відмовив — відкат до попереднього стану й повідомлення про помилку.
  await screen.findByRole('button', { name: 'Додати у вішлист' })
  await screen.findByText(/Не вдалося звʼязатися з API/)
})
