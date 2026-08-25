import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { addWishlistItemRequestSchema } from '@bookswap/shared'
import type { ZodType } from 'zod'
import { AddWishlistItemDto } from './wishlist.dto'

/** Той самий тест парності, що й для решти DTO (§11). */
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

describe('AddWishlistItemDto ↔ addWishlistItemRequestSchema', () => {
  it('однаково приймає й відхиляє однакові дані', () => {
    expectAgreement(AddWishlistItemDto, addWishlistItemRequestSchema, [
      { name: 'id твору', payload: { workId: 'work-1' }, valid: true },
      { name: 'без твору', payload: {}, valid: false },
      { name: 'порожній id', payload: { workId: '   ' }, valid: false },
      { name: 'надто довгий id', payload: { workId: 'x'.repeat(65) }, valid: false },
    ])
  })

  it('невідомі поля: zod зрізає, DTO відхиляє', () => {
    const stripped = addWishlistItemRequestSchema.parse({ workId: 'work-1', userId: 'user-2' })

    expect(stripped).toEqual({ workId: 'work-1' })
    expect(acceptedByDto(AddWishlistItemDto, { workId: 'work-1', userId: 'user-2' })).toBe(false)
  })
})
