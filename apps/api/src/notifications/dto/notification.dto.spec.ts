import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { notificationQueryRequestSchema } from '@bookswap/shared'
import { NotificationQueryDto } from './notification.dto'

/** Той самий тест парності, що й для решти DTO (§11). */
function acceptedByDto(payload: unknown): boolean {
  const instance = plainToInstance(NotificationQueryDto, payload)

  return (
    validateSync(instance as object, { whitelist: true, forbidNonWhitelisted: true }).length === 0
  )
}

describe('NotificationQueryDto ↔ notificationQueryRequestSchema', () => {
  const cases: { name: string; payload: unknown; valid: boolean }[] = [
    { name: 'без фільтра', payload: {}, valid: true },
    { name: 'unread=true', payload: { unread: 'true' }, valid: true },
    { name: 'unread=false', payload: { unread: 'false' }, valid: true },
    // Синоніми навмисно не приймаються: кожен із них довелося б дослівно
    // повторити в обох механізмах, і перша ж розбіжність пройшла б непоміченою.
    { name: 'unread=1', payload: { unread: '1' }, valid: false },
    { name: 'unread=yes', payload: { unread: 'yes' }, valid: false },
    { name: 'unread=maybe', payload: { unread: 'maybe' }, valid: false },
    { name: 'порожній рядок', payload: { unread: '' }, valid: false },
  ]

  it('однаково приймає й відхиляє однакові дані', () => {
    for (const { name, payload, valid } of cases) {
      const byZod = notificationQueryRequestSchema.safeParse(payload).success
      const byDto = acceptedByDto(payload)

      expect({ name, byZod, byDto }).toEqual({ name, byZod: valid, byDto: valid })
    }
  })

  it('обидва механізми віддають булеве, а не рядок', () => {
    // `enableImplicitConversion: false` лишає query-параметр рядком, тож
    // перетворення робить кожен механізм сам — і мусить робити однаково.
    expect(notificationQueryRequestSchema.parse({ unread: 'true' }).unread).toBe(true)
    expect(notificationQueryRequestSchema.parse({ unread: 'false' }).unread).toBe(false)

    const instance = plainToInstance(NotificationQueryDto, { unread: 'true' })

    expect(instance.unread).toBe(true)
  })

  it('невідоме значення не зводиться тихо до false', () => {
    // Мовчазний фолбек показав би не той список і не сказав би про це.
    expect(acceptedByDto({ unread: 'maybe' })).toBe(false)
  })
})
