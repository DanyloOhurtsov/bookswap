/** @jest-environment jsdom */

import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionState } from '@/app/lib/use-session'
import { SessionBoundary } from '@/components/SessionBoundary'

jest.mock('@/app/lib/use-session', () => ({
  useSession: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

const { useSession: mockUseSession } = jest.requireMock<{ useSession: jest.Mock }>(
  '@/app/lib/use-session',
)
const { useRouter: mockUseRouter } = jest.requireMock<{ useRouter: jest.Mock }>('next/navigation')

const reload = jest.fn()
const replace = jest.fn()
const setUser = jest.fn()

function setSessionState(state: SessionState): void {
  mockUseSession.mockReturnValue({ state, reload, setUser })
}

beforeEach(() => {
  reload.mockReset()
  replace.mockReset()
  setUser.mockReset()
  mockUseRouter.mockReturnValue({ replace })
})

describe('SessionBoundary', () => {
  it('renders the shared Shell while the session is loading', () => {
    setSessionState({ status: 'loading' })

    render(<SessionBoundary title="Моя сторінка">Приватний вміст</SessionBoundary>)

    expect(screen.getByRole('heading', { name: 'Моя сторінка' })).toBeInTheDocument()
    expect(screen.getByLabelText('Перевіряю сесію')).toBeInTheDocument()
    expect(screen.queryByText('Приватний вміст')).not.toBeInTheDocument()
  })

  it('shows a retryable session error', async () => {
    const user = userEvent.setup()
    setSessionState({ status: 'error', message: 'Сесію не завантажено' })

    render(<SessionBoundary title="Моя сторінка">Приватний вміст</SessionBoundary>)

    expect(screen.getByRole('alert')).toHaveTextContent('Сесію не завантажено')
    await user.click(screen.getByRole('button', { name: 'Спробувати ще раз' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('redirects guests and keeps authenticated content unmounted', async () => {
    setSessionState({ status: 'guest' })

    render(<SessionBoundary title="Моя сторінка">Приватний вміст</SessionBoundary>)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(screen.queryByText('Приватний вміст')).not.toBeInTheDocument()
  })

  it('provides the authenticated user and session actions to a render prop', () => {
    setSessionState({
      status: 'authenticated',
      user: {
        id: 'me',
        email: 'me@example.com',
        displayName: 'Ярина',
        avatarUrl: null,
        bio: null,
        emailVerified: true,
        libraryVisibility: 'FRIENDS',
        showHolderNames: true,
        createdAt: '2026-08-01T10:00:00.000Z',
      },
    })

    render(
      <SessionBoundary title="Моя сторінка">
        {({ user, reload: retry, setUser: updateUser }) => (
          <button
            type="button"
            onClick={() => {
              retry()
              updateUser(user)
            }}
          >
            {user.displayName}
          </button>
        )}
      </SessionBoundary>,
    )

    screen.getByRole('button', { name: 'Ярина' }).click()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'me' }))
  })
})
