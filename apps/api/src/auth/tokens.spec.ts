import { generateToken, hashToken } from './tokens'

describe('generateToken', () => {
  it('дає 256 біт у base64url', () => {
    const token = generateToken()

    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('не містить символів, які довелося б екранувати в URL і кукі', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('не повторюється', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()))

    expect(tokens.size).toBe(500)
  })
})

describe('hashToken', () => {
  it('дає стабільний SHA-256 у hex', () => {
    expect(hashToken('token')).toBe(hashToken('token'))
    expect(hashToken('token')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('різні токени — різні гефі', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })

  it('із гешу не видно токена', () => {
    const token = generateToken()

    expect(hashToken(token)).not.toContain(token)
  })
})
