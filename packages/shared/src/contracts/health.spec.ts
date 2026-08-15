import { healthResponseSchema } from './health'

describe('healthResponseSchema', () => {
  it('приймає валідну відповідь health', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: 12.5,
    })

    expect(parsed.status).toBe('ok')
  })

  it('приймає нульовий аптайм одразу після старту', () => {
    expect(() =>
      healthResponseSchema.parse({ status: 'ok', version: '0.1.0', uptimeSeconds: 0 }),
    ).not.toThrow()
  })

  it('відхиляє будь-який статус, крім ok', () => {
    expect(() =>
      healthResponseSchema.parse({ status: 'degraded', version: '0.1.0', uptimeSeconds: 1 }),
    ).toThrow()
  })

  it('відхиляє відʼємний аптайм', () => {
    expect(() =>
      healthResponseSchema.parse({ status: 'ok', version: '0.1.0', uptimeSeconds: -1 }),
    ).toThrow()
  })
})
