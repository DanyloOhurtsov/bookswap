import type { CookieOptions, Response } from 'express'
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './auth.constants'
import { clearSessionCookie, setSessionCookie } from './session.cookie'

interface Recorded {
  name: string
  value?: string
  options: CookieOptions
}

function recorder(): { response: Response; set: Recorded[]; cleared: Recorded[] } {
  const set: Recorded[] = []
  const cleared: Recorded[] = []

  const response = {
    cookie(name: string, value: string, options: CookieOptions) {
      set.push({ name, value, options })
      return this
    },
    clearCookie(name: string, options: CookieOptions) {
      cleared.push({ name, options })
      return this
    },
  } as unknown as Response

  return { response, set, cleared }
}

describe('setSessionCookie', () => {
  it('§6.1: httpOnly і SameSite=Lax', () => {
    const { response, set } = recorder()

    setSessionCookie(response, 'token', false)

    expect(set).toHaveLength(1)
    expect(set[0]?.name).toBe(SESSION_COOKIE_NAME)
    expect(set[0]?.value).toBe('token')
    expect(set[0]?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
  })

  it('Secure лише в production', () => {
    const dev = recorder()
    const prod = recorder()

    setSessionCookie(dev.response, 'token', false)
    setSessionCookie(prod.response, 'token', true)

    // У dev усе по http://localhost — із Secure кукі просто не встановилася б.
    expect(dev.set[0]?.options.secure).toBe(false)
    expect(prod.set[0]?.options.secure).toBe(true)
  })

  it('термін життя кукі збігається з терміном сесії', () => {
    const { response, set } = recorder()

    setSessionCookie(response, 'token', true)

    expect(set[0]?.options.maxAge).toBe(SESSION_TTL_MS)
  })
})

describe('clearSessionCookie', () => {
  it('гасить кукі тими самими атрибутами, якими вона ставилася', () => {
    const { response, set, cleared } = recorder()

    setSessionCookie(response, 'token', true)
    clearSessionCookie(response, true)

    const { maxAge: _maxAge, ...setOptions } = set[0]?.options ?? {}

    // Розбіжність в атрибутах — це для браузера інша кукі, і стара лишиться жити.
    expect(cleared[0]?.options).toEqual(setOptions)
    expect(cleared[0]?.name).toBe(SESSION_COOKIE_NAME)
  })
})
