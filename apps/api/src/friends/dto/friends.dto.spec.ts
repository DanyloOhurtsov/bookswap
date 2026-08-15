import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { createFriendRequestSchema, respondFriendRequestSchema } from '@bookswap/shared'
import type { ZodType } from 'zod'
import { CreateFriendRequestDto, RespondFriendRequestDto } from './friends.dto'

/**
 * Той самий тест парності, що й для DTO акаунта (`auth/dto/auth.dto.spec.ts`):
 * §11 вимагає обидва механізми валідації, а платою за це є ризик, що два описи
 * однієї структури розійдуться. Тут він ловиться, а не на проді.
 */
type Constructor<T> = new () => T

function acceptedByDto<T extends object>(Dto: Constructor<T>, payload: unknown): boolean {
  const instance = plainToInstance(Dto, payload)

  return (
    validateSync(instance as object, { whitelist: true, forbidNonWhitelisted: true }).length === 0
  )
}

function expectAgreement<T extends object>(
  Dto: Constructor<T>,
  schema: ZodType,
  cases: { name: string; payload: unknown; valid: boolean }[],
): void {
  for (const { name, payload, valid } of cases) {
    const byZod = schema.safeParse(payload).success
    const byDto = acceptedByDto(Dto, payload)

    expect({ name, byZod, byDto }).toEqual({ name, byZod: valid, byDto: valid })
  }
}

describe('CreateFriendRequestDto ↔ createFriendRequestSchema', () => {
  it('однаково приймає й відхиляє однакові дані', () => {
    expectAgreement(CreateFriendRequestDto, createFriendRequestSchema, [
      { name: 'звичайний id', payload: { userId: 'ckl1a2b3c4d5e6f7g8h9i0j1' }, valid: true },
      { name: 'id із пробілами по краях', payload: { userId: ' ckl1a2b3 ' }, valid: true },
      { name: 'порожній id', payload: { userId: '' }, valid: false },
      { name: 'самі пробіли', payload: { userId: '   ' }, valid: false },
      { name: 'id на межі', payload: { userId: 'x'.repeat(64) }, valid: true },
      { name: 'id на символ довший', payload: { userId: 'x'.repeat(65) }, valid: false },
      { name: 'без поля', payload: {}, valid: false },
      { name: 'число замість рядка', payload: { userId: 42 }, valid: false },
    ])
  })

  it('обидва механізми обрізають пробіли однаково', () => {
    const instance = plainToInstance(CreateFriendRequestDto, { userId: ' ckl1a2b3 ' })

    expect(instance.userId).toBe('ckl1a2b3')
    expect(createFriendRequestSchema.parse({ userId: ' ckl1a2b3 ' }).userId).toBe('ckl1a2b3')
  })
})

describe('RespondFriendRequestDto ↔ respondFriendRequestSchema', () => {
  it('однаково приймає й відхиляє однакові дані', () => {
    expectAgreement(RespondFriendRequestDto, respondFriendRequestSchema, [
      { name: 'accept', payload: { action: 'accept' }, valid: true },
      { name: 'decline', payload: { action: 'decline' }, valid: true },
      // block і remove мають власні маршрути §8 — крізь PATCH вони не проходять.
      { name: 'block', payload: { action: 'block' }, valid: false },
      { name: 'remove', payload: { action: 'remove' }, valid: false },
      { name: 'інший регістр', payload: { action: 'ACCEPT' }, valid: false },
      { name: 'без поля', payload: {}, valid: false },
    ])
  })
})
