/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { NavBarNotifications } from './NavBarNotifications'

jest.mock('@/app/lib/use-notifications', () => ({
  useNotifications: jest.fn(),
}))

const { useNotifications: mockUseNotifications } = jest.requireMock<{
  useNotifications: jest.Mock
}>('@/app/lib/use-notifications')

const reload = jest.fn(async () => undefined)

function mockReady(unreadCount: number): void {
  mockUseNotifications.mockReturnValue({
    state: { status: 'ready', data: { notifications: [], unreadCount } },
    reload,
  })
}

beforeEach(() => {
  mockUseNotifications.mockReset()
  reload.mockClear()
})

describe('NavBarNotifications', () => {
  it('announces and renders the unread count', () => {
    mockReady(3)

    render(<NavBarNotifications />)

    expect(
      screen.getByRole('button', { name: 'Відкрити сповіщення: 3 непрочитаних' }),
    ).toBeVisible()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('caps the visual badge without hiding the exact accessible count', () => {
    mockReady(101)

    render(<NavBarNotifications />)

    expect(
      screen.getByRole('button', { name: 'Відкрити сповіщення: 101 непрочитаних' }),
    ).toBeVisible()
    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it('renders a neutral label while notifications are loading', () => {
    mockUseNotifications.mockReturnValue({
      state: { status: 'loading' },
      reload,
    })

    render(<NavBarNotifications />)

    expect(screen.getByRole('button', { name: 'Відкрити сповіщення' })).toBeVisible()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
