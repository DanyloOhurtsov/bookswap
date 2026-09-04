/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { BookLookupResult, WorkDetailResponse } from '@bookswap/shared'
import { ApiRequestError } from '@/app/lib/api'
import { SearchStep } from './SearchStep'

jest.mock('@/app/lib/api', () => {
  const actual = jest.requireActual<typeof import('@/app/lib/api')>('@/app/lib/api')

  return { ...actual, apiRequest: jest.fn() }
})

/**
 * `BarcodeScannerPanel` has its own dedicated spec covering camera
 * lifecycle/errors — here it's replaced by a deterministic stand-in so
 * `SearchStep` tests exercise only the entry-method threading contract.
 * Mocked by the named loader module (not `./BarcodeScannerPanel` directly):
 * `SearchStep` reaches it via `next/dynamic`, whose loader argument contains
 * a real dynamic `import()` that this project's ts-jest config can't
 * execute — mocking the whole loader module sidesteps that entirely.
 */
jest.mock('../lib/load-barcode-scanner-panel', () => ({
  loadBarcodeScannerPanel: () =>
    Promise.resolve(({ onValidIsbn }: { onValidIsbn: (isbn: string) => void }) => (
      <button type="button" onClick={() => onValidIsbn('9783161484100')}>
        Simulate scan
      </button>
    )),
}))

const { apiRequest: mockApiRequest } = jest.requireMock<{ apiRequest: jest.Mock }>('@/app/lib/api')

const ISBN = '9783161484100'
const lookup: BookLookupResult = { title: 'Lookup title', language: 'en' }
const candidate: WorkDetailResponse = {
  work: {
    id: 'work-1',
    title: 'Кобзар',
    origLang: 'uk',
    firstPubYear: 1840,
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  authors: [{ id: 'author-1', name: 'Тарас Шевченко', nameLatin: null, role: 'AUTHOR' }],
  translations: [],
  editions: [
    {
      id: 'edition-1',
      workId: 'work-1',
      translationId: null,
      publisher: 'Наука',
      year: 2019,
      isbn13: ISBN,
      pageCount: 320,
      coverUrl: null,
      format: 'HARDCOVER',
      lang: 'uk',
      translator: null,
    },
  ],
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value: T) {
      resolvePromise?.(value)
    },
  }
}

function renderSearch(initialQuery = '', entryMode: 'manual' | 'scan' = 'manual') {
  const callbacks = {
    onFoundEdition: jest.fn(),
    onFoundWork: jest.fn(),
    onCreateNew: jest.fn(),
  }

  render(<SearchStep initialQuery={initialQuery} entryMode={entryMode} {...callbacks} />)

  return callbacks
}

beforeEach(() => {
  mockApiRequest.mockReset()
})

it('validates the query with the shared Zod contract before searching', async () => {
  const user = userEvent.setup()
  renderSearch()

  await user.type(screen.getByLabelText('Назва або ISBN'), 'x')
  await user.click(screen.getByRole('button', { name: 'Шукати' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Мінімум два символи')
  expect(mockApiRequest).not.toHaveBeenCalled()
})

it('starts candidate and ISBN lookup requests in parallel and preserves the selection context', async () => {
  const candidatesRequest = deferred<{ candidates: WorkDetailResponse[] }>()
  const lookupRequest = deferred<{ result: BookLookupResult }>()

  mockApiRequest.mockImplementation((path: string) => {
    return path.startsWith('/catalog/search/candidates')
      ? candidatesRequest.promise
      : lookupRequest.promise
  })

  const callbacks = renderSearch(ISBN)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Шукати' }))

  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2))
  lookupRequest.resolve({ result: lookup })
  candidatesRequest.resolve({ candidates: [candidate] })

  expect(await screen.findByText('точний збіг за ISBN')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Це моє видання' }))
  expect(callbacks.onFoundEdition).toHaveBeenCalledWith({
    workId: 'work-1',
    title: 'Кобзар',
    editionId: 'edition-1',
    entryMethod: 'MANUAL',
  })

  await user.click(screen.getByRole('button', { name: 'У мене інше видання цього твору' }))
  expect(callbacks.onFoundWork).toHaveBeenCalledWith({
    workId: 'work-1',
    title: 'Кобзар',
    isbn: ISBN,
    lookup,
    existingTranslations: [],
    entryMethod: 'MANUAL',
  })
})

it('keeps the validated query for a retry and then creates a new work from its result', async () => {
  mockApiRequest
    .mockRejectedValueOnce(
      new ApiRequestError(429, {
        code: 'TOO_MANY_REQUESTS',
        message: 'ThrottlerException: Too Many Requests',
      }),
    )
    .mockResolvedValueOnce({ candidates: [] })

  const callbacks = renderSearch()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Назва або ISBN'), '  Дюна  ')
  await user.click(screen.getByRole('button', { name: 'Шукати' }))

  expect(
    await screen.findByText('Забагато запитів поспіль. Зачекайте хвилину і спробуйте ще раз.'),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Шукати' }))
  await user.click(await screen.findByRole('button', { name: 'Створити новий твір' }))

  expect(mockApiRequest).toHaveBeenCalledTimes(2)
  expect(callbacks.onCreateNew).toHaveBeenCalledWith({
    initialTitle: 'Дюна',
    entryMethod: 'MANUAL',
  })
})

describe('entryMode="scan"', () => {
  it('shows the scanner alongside the always-visible manual field', async () => {
    renderSearch('', 'scan')

    expect(screen.getByLabelText('Назва або ISBN')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Simulate scan' })).toBeInTheDocument()
  })

  it('does not show the scanner in manual mode', () => {
    renderSearch('', 'manual')

    expect(screen.queryByRole('button', { name: 'Simulate scan' })).not.toBeInTheDocument()
  })

  it('routes a scanned ISBN through the same search orchestration and tags the result BARCODE', async () => {
    mockApiRequest.mockImplementation((path: string) => {
      return path.startsWith('/catalog/search/candidates')
        ? Promise.resolve({ candidates: [candidate] })
        : Promise.resolve({ result: lookup })
    })

    const callbacks = renderSearch('', 'scan')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Simulate scan' }))

    expect(await screen.findByText('точний збіг за ISBN')).toBeInTheDocument()
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.stringContaining('/catalog/search/candidates'),
      expect.anything(),
    )

    await user.click(screen.getByRole('button', { name: 'Це моє видання' }))
    expect(callbacks.onFoundEdition).toHaveBeenCalledWith({
      workId: 'work-1',
      title: 'Кобзар',
      editionId: 'edition-1',
      entryMethod: 'BARCODE',
    })
  })

  it('a manual submit after a successful scan resets the tag to MANUAL and stops the scanner', async () => {
    mockApiRequest.mockResolvedValue({ candidates: [candidate] })

    const callbacks = renderSearch('', 'scan')
    const user = userEvent.setup()

    const scanButton = screen.getByRole('button', { name: 'Simulate scan' })
    await user.click(scanButton)
    await screen.findByRole('button', { name: 'Це моє видання' })

    await user.type(screen.getByLabelText('Назва або ISBN'), 'Кобзар')
    await user.click(screen.getByRole('button', { name: 'Шукати' }))
    await screen.findByRole('button', { name: 'Це моє видання' })

    await user.click(screen.getByRole('button', { name: 'Це моє видання' }))
    expect(callbacks.onFoundEdition).toHaveBeenLastCalledWith(
      expect.objectContaining({ entryMethod: 'MANUAL' }),
    )

    // The scanner remounted (key bump) — a fresh instance, not the stale one.
    expect(screen.getByRole('button', { name: 'Simulate scan' })).not.toBe(scanButton)
  })
})
