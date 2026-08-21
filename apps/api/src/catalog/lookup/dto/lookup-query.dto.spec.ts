import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { bookLookupRequestSchema } from '@bookswap/shared'
import { LookupQueryDto } from './lookup-query.dto'

/**
 * Той самий тест парності, що й для DTO каталогу (`catalog.dto.spec.ts`): §11
 * вимагає і zod, і class-validator, і обидва мусять сходитись у вироку —
 * інакше невалідний ISBN пройшов би в один шар валідації, але не в другий.
 */
function acceptedByDto(payload: unknown): boolean {
  const instance = plainToInstance(LookupQueryDto, payload)

  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).length === 0
}

describe('LookupQueryDto ↔ bookLookupRequestSchema', () => {
  it.each([
    { name: 'валідний ISBN-13', payload: { isbn: '9783161484100' }, valid: true },
    {
      name: 'валідний ISBN-13 з дефісами й пробілами',
      payload: { isbn: '978-3-16-148410-0' },
      valid: true,
    },
    { name: 'невірна контрольна сума', payload: { isbn: '9783161484101' }, valid: false },
    { name: 'не ISBN узагалі', payload: { isbn: 'not-an-isbn' }, valid: false },
    { name: 'відсутній isbn', payload: {}, valid: false },
  ])('$name', ({ payload, valid }) => {
    const byZod = bookLookupRequestSchema.safeParse(payload).success
    const byDto = acceptedByDto(payload)

    expect({ byZod, byDto }).toEqual({ byZod: valid, byDto: valid })
  })

  it('нормалізує ISBN так само, як схема', () => {
    const instance = plainToInstance(LookupQueryDto, { isbn: '978-3-16-148410-0' })

    expect(instance.isbn).toBe('9783161484100')
  })
})
