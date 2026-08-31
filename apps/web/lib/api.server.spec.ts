import { SESSION_COOKIE_NAME, myHistoryResponseSchema } from '@bookswap/shared'
import { z } from 'zod'
import { ApiRequestError } from '@/app/lib/api'
import { fetchAuthenticated } from './api.server'

jest.mock('server-only', () => ({}))
jest.mock('next/headers', () => ({ cookies: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))

const { cookies: mockCookies } = jest.requireMock<{ cookies: jest.Mock }>('next/headers')
const { redirect: mockRedirect } = jest.requireMock<{ redirect: jest.Mock }>('next/navigation')

const responseSchema = z.object({ id: z.string() })

function setSessionCookie(value?: string): jest.Mock {
  const get = jest.fn((name: string) => {
    if (name !== SESSION_COOKIE_NAME || value === undefined) return undefined

    return { name, value }
  })

  mockCookies.mockResolvedValue({
    get,
    getAll: () => [
      { name: 'analytics_id', value: 'private-analytics-value' },
      ...(value === undefined ? [] : [{ name: SESSION_COOKIE_NAME, value }]),
    ],
  })

  return get
}

function stubFetch(status: number, payload: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    json: () => Promise.resolve(payload),
  })

  global.fetch = mock

  return mock
}

beforeEach(() => {
  mockCookies.mockReset()
  mockRedirect.mockReset()
})

describe('fetchAuthenticated', () => {
  it('форвардить у Nest лише сесійну cookie', async () => {
    const getCookie = setSessionCookie('session-token')
    const mockFetch = stubFetch(200, { id: 'history', ignored: true })

    await expect(fetchAuthenticated('/me/history', responseSchema)).resolves.toEqual({
      id: 'history',
    })

    expect(getCookie).toHaveBeenCalledTimes(1)
    expect(getCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/me/history'),
      expect.objectContaining({
        headers: { Cookie: `${SESSION_COOKIE_NAME}=session-token` },
      }),
    )
  })

  it('не створює Cookie header без сесійної cookie', async () => {
    setSessionCookie()
    const mockFetch = stubFetch(200, { id: 'history' })

    await fetchAuthenticated('/me/history', responseSchema)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: {} }),
    )
  })

  it('перетворює 401 на redirect до login', async () => {
    setSessionCookie('expired')
    stubFetch(401, { code: 'UNAUTHORIZED', message: 'Потрібна сесія' })
    mockRedirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })

    await expect(fetchAuthenticated('/me/history', responseSchema)).rejects.toThrow('NEXT_REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('не перетворює іншу API помилку на redirect', async () => {
    setSessionCookie('session-token')
    stubFetch(503, { code: 'INTERNAL_ERROR', message: 'API unavailable' })

    await expect(fetchAuthenticated('/me/history', responseSchema)).rejects.toBeInstanceOf(
      ApiRequestError,
    )
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('не перетворює network error на порожні дані', async () => {
    const networkError = new TypeError('network unavailable')

    setSessionCookie('session-token')
    global.fetch = jest.fn().mockRejectedValue(networkError)

    await expect(fetchAuthenticated('/me/history', responseSchema)).rejects.toBe(networkError)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('перевіряє response переданою shared Zod-схемою', async () => {
    setSessionCookie('session-token')
    stubFetch(200, { borrowed: [], lent: [{ invalid: true }] })

    await expect(fetchAuthenticated('/me/history', myHistoryResponseSchema)).rejects.toThrow(
      'Відповідь API не відповідає спільному контракту',
    )
  })
})
