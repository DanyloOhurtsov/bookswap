/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import {
  myHistoryResponseSchema,
  type MyHistoryEntry,
  type MyHistoryResponse,
} from '@bookswap/shared'
import HistoryPage from './page'

jest.mock('@/lib/api.server', () => ({ fetchAuthenticated: jest.fn() }))
jest.mock('@/app/lib/use-history', () => ({ useMyHistory: jest.fn() }))

const { fetchAuthenticated: mockFetchAuthenticated } = jest.requireMock<{
  fetchAuthenticated: jest.Mock
}>('@/lib/api.server')
const { useMyHistory: mockUseMyHistory } = jest.requireMock<{ useMyHistory: jest.Mock }>(
  '@/app/lib/use-history',
)

interface HistoryItemFixture {
  prefix: string
  title: string
  author: string
}

function historyItem({ prefix, title, author }: HistoryItemFixture): MyHistoryEntry {
  return {
    entry: {
      names: true,
      loanId: `${prefix}-loan`,
      status: 'RETURNED',
      isOverdue: false,
      requestedAt: '2026-05-01T10:00:00.000Z',
      respondedAt: '2026-05-02T10:00:00.000Z',
      handedAt: '2026-05-03T10:00:00.000Z',
      returnedAt: '2026-05-10T10:00:00.000Z',
      dueAt: '2026-05-12',
      owner: { id: `${prefix}-owner`, displayName: 'Власник', avatarUrl: null },
      borrower: { id: `${prefix}-borrower`, displayName: 'Позичальник', avatarUrl: null },
    },
    copy: {
      id: `${prefix}-copy`,
      status: 'AVAILABLE',
      condition: 'GOOD',
      work: {
        id: `${prefix}-work`,
        title,
        origLang: 'uk',
        firstPubYear: 1840,
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      authors: [{ id: `${prefix}-author`, name: author, nameLatin: null, role: 'AUTHOR' }],
      edition: {
        id: `${prefix}-edition`,
        workId: `${prefix}-work`,
        translationId: null,
        publisher: 'КСД',
        year: 2024,
        isbn13: null,
        pageCount: 320,
        coverUrl: null,
        format: 'HARDCOVER',
        lang: 'uk',
        translator: null,
      },
    },
  }
}

const borrowedItem = historyItem({
  prefix: 'borrowed',
  title: 'Позичений Кобзар',
  author: 'Тарас Шевченко',
})
const lentItem = historyItem({
  prefix: 'lent',
  title: 'Позичений іншому Роман',
  author: 'Автор Роману',
})
const populatedHistory: MyHistoryResponse = {
  borrowed: [borrowedItem],
  lent: [lentItem],
}
const emptyHistory: MyHistoryResponse = { borrowed: [], lent: [] }

type SearchParams = Record<string, string | string[] | undefined>

async function renderPage(
  searchParams: SearchParams = {},
  response: MyHistoryResponse = populatedHistory,
): Promise<void> {
  mockFetchAuthenticated.mockResolvedValue(response)

  render(await HistoryPage({ searchParams: Promise.resolve(searchParams) }))
}

beforeEach(() => {
  mockFetchAuthenticated.mockReset()
  mockUseMyHistory.mockReset()
})

describe('history route URL view', () => {
  it('/history рендерить borrowed view за замовчуванням одним server request', async () => {
    await renderPage()

    expect(screen.getByText('Позичений Кобзар')).toBeInTheDocument()
    expect(screen.queryByText('Позичений іншому Роман')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Що я брав' })).toHaveAttribute('aria-current', 'page')
    expect(mockFetchAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockFetchAuthenticated).toHaveBeenCalledWith('/me/history', myHistoryResponseSchema)
    expect(mockUseMyHistory).not.toHaveBeenCalled()
  })

  it('?view=borrowed рендерить borrowed view', async () => {
    await renderPage({ view: 'borrowed' })

    expect(screen.getByText('Позичений Кобзар')).toBeInTheDocument()
    expect(screen.queryByText('Позичений іншому Роман')).not.toBeInTheDocument()
  })

  it('?view=lent рендерить lent view', async () => {
    await renderPage({ view: 'lent' })

    expect(screen.getByText('Позичений іншому Роман')).toBeInTheDocument()
    expect(screen.queryByText('Позичений Кобзар')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Що в мене брали' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it.each([
    ['unknown value', 'other'],
    ['empty value', ''],
    ['multiple values', ['lent', 'borrowed']],
  ])('%s безпечно використовує borrowed fallback', async (_case, view) => {
    await renderPage({ view })

    expect(screen.getByText('Позичений Кобзар')).toBeInTheDocument()
    expect(screen.queryByText('Позичений іншому Роман')).not.toBeInTheDocument()
  })
})

describe('history route states and content', () => {
  it('показує borrowed empty state', async () => {
    await renderPage({}, emptyHistory)

    expect(screen.getByText('Ви ще нічого не брали.')).toBeInTheDocument()
  })

  it('показує lent empty state', async () => {
    await renderPage({ view: 'lent' }, emptyHistory)

    expect(screen.getByText('У вас ще нічого не брали.')).toBeInTheDocument()
  })

  it('зберігає каталожні metadata, loan facts і навігаційні посилання', async () => {
    await renderPage({ view: 'borrowed' })

    expect(screen.getByRole('link', { name: 'Позичений Кобзар' })).toHaveAttribute(
      'href',
      '/works/borrowed-work',
    )
    expect(screen.getByText('Тарас Шевченко')).toBeInTheDocument()
    expect(screen.getByText('КСД · 2024 · uk · тверда · 320 с.')).toBeInTheDocument()
    expect(screen.getByText(/Повернено · Позичальник у Власник/)).toBeInTheDocument()
    expect(screen.getByText(/Попросили/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Уся історія примірника' })).toHaveAttribute(
      'href',
      '/copies/borrowed-copy/history',
    )
  })
})
