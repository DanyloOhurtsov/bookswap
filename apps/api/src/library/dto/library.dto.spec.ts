import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import {
  addCopyRequestSchema,
  libraryQueryRequestSchema,
  updateCopyRequestSchema,
} from '@bookswap/shared'
import type { ZodType } from 'zod'
import { AddCopyDto, LibraryQueryDto, UpdateCopyDto } from './library.dto'

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

describe('AddCopyDto ↔ addCopyRequestSchema', () => {
  it('однаково приймає й відхиляє однакові дані', () => {
    expectAgreement(AddCopyDto, addCopyRequestSchema, [
      { name: 'лише видання', payload: { editionId: 'edition-1' }, valid: true },
      {
        name: 'усі поля',
        payload: {
          editionId: 'e-1',
          condition: 'WORN',
          note: 'пляма',
          visibility: 'PRIVATE',
          acquiredAt: '2026-03-01',
          entryMethod: 'BARCODE',
        },
        valid: true,
      },
      { name: 'без видання', payload: {}, valid: false },
      { name: 'порожнє видання', payload: { editionId: '   ' }, valid: false },
      { name: 'невідомий стан', payload: { editionId: 'e-1', condition: 'MINT' }, valid: false },
      {
        name: 'невідома видимість',
        payload: { editionId: 'e-1', visibility: 'SECRET' },
        valid: false,
      },
      {
        name: 'невідомий спосіб додавання',
        payload: { editionId: 'e-1', entryMethod: 'CSV' },
        valid: false,
      },
      { name: 'нотатку прибрано null', payload: { editionId: 'e-1', note: null }, valid: true },
      {
        name: 'дата з часом',
        payload: { editionId: 'e-1', acquiredAt: '2026-03-01T10:00:00.000Z' },
        valid: false,
      },
      {
        name: 'неіснуюча дата',
        payload: { editionId: 'e-1', acquiredAt: '2026-02-31' },
        valid: false,
      },
      {
        name: '29 лютого високосного року',
        payload: { editionId: 'e-1', acquiredAt: '2024-02-29' },
        valid: true,
      },
    ])
  })

  /**
   * Розбіжність, зафіксована навмисно: zod зрізає невідомі поля, а
   * `forbidNonWhitelisted` відхиляє весь запит. Обидва результати безпечні —
   * ні `quantity` (§3: кількість примірників це COUNT рядків, а не поле), ні
   * чужий `ownerId` не доїжджають до Prisma в жодному з механізмів.
   */
  it('невідомі поля: zod зрізає, DTO відхиляє', () => {
    const stripped = addCopyRequestSchema.parse({
      editionId: 'e-1',
      quantity: 3,
      ownerId: 'user-2',
    })

    expect(stripped).toEqual({ editionId: 'e-1' })
    expect(acceptedByDto(AddCopyDto, { editionId: 'e-1', quantity: 3 })).toBe(false)
    expect(acceptedByDto(AddCopyDto, { editionId: 'e-1', ownerId: 'user-2' })).toBe(false)
  })
})

describe('UpdateCopyDto ↔ updateCopyRequestSchema', () => {
  it('однаково приймає й відхиляє однакові дані', () => {
    expectAgreement(UpdateCopyDto, updateCopyRequestSchema, [
      { name: 'нотатка', payload: { note: 'нова' }, valid: true },
      { name: 'нотатку прибрано', payload: { note: null }, valid: true },
      { name: 'стан примірника', payload: { condition: 'DAMAGED' }, valid: true },
      { name: 'видимість', payload: { visibility: 'PRIVATE' }, valid: true },
      { name: 'status=AVAILABLE', payload: { status: 'AVAILABLE' }, valid: true },
      { name: 'status=UNAVAILABLE', payload: { status: 'UNAVAILABLE' }, valid: true },
      // §5.1: цими станами керує виключно стейт-машина лоанів.
      { name: 'status=RESERVED', payload: { status: 'RESERVED' }, valid: false },
      { name: 'status=LENT_OUT', payload: { status: 'LENT_OUT' }, valid: false },
      { name: 'підміна тримача', payload: { currentHolderId: 'user-2' }, valid: false },
      { name: 'підміна видання', payload: { editionId: 'edition-2' }, valid: false },
    ])
  })

  /**
   * Розбіжність, зафіксована навмисно — така сама, як у `PATCH /me`:
   * «хоч одне поле» — правило про **набір** полів, і class-validator його не
   * виражає. На бекенді його перевіряє контролер, у контракті — `.refine()`.
   */
  it('порожнє тіло: zod відхиляє, DTO ні — перевірку робить контролер', () => {
    expect(updateCopyRequestSchema.safeParse({}).success).toBe(false)
    expect(acceptedByDto(UpdateCopyDto, {})).toBe(true)
  })
})

describe('LibraryQueryDto ↔ libraryQueryRequestSchema', () => {
  it('однаково приймає й відхиляє однакові дані', () => {
    expectAgreement(LibraryQueryDto, libraryQueryRequestSchema, [
      { name: 'без фільтрів', payload: {}, valid: true },
      { name: 'за статусом', payload: { status: 'LENT_OUT' }, valid: true },
      { name: 'невідомий статус', payload: { status: 'MISSING' }, valid: false },
      { name: 'за мовою', payload: { lang: 'uk' }, valid: true },
      { name: 'невідома мова', payload: { lang: 'zz' }, valid: false },
      { name: 'за текстом', payload: { q: 'шантарам' }, valid: true },
      { name: 'закороткий текст', payload: { q: 'ш' }, valid: false },
      {
        name: 'усі три разом',
        payload: { status: 'AVAILABLE', lang: 'uk', q: 'гобіт' },
        valid: true,
      },
    ])
  })

  it('фільтр статусу приймає всі чотири стани §4.5 — на відміну від редагування', () => {
    for (const status of ['AVAILABLE', 'RESERVED', 'LENT_OUT', 'UNAVAILABLE']) {
      expect(acceptedByDto(LibraryQueryDto, { status })).toBe(true)
    }
  })
})
