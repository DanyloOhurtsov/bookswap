import {
  PRODUCT_EVENT_PROPERTIES_SCHEMA,
  PRODUCT_EVENT_TYPE,
  productEventInputSchema,
} from './product-event.types'

describe('PRODUCT_EVENT_PROPERTIES_SCHEMA (§4)', () => {
  it('валідні (порожні) properties для кожного типу, крім BOOK_ADDED', () => {
    for (const type of PRODUCT_EVENT_TYPE) {
      if (type === 'BOOK_ADDED') continue

      expect(PRODUCT_EVENT_PROPERTIES_SCHEMA[type].safeParse({}).success).toBe(true)
    }
  })

  it('BOOK_ADDED приймає MANUAL/BARCODE/CSV', () => {
    for (const method of ['MANUAL', 'BARCODE', 'CSV']) {
      expect(PRODUCT_EVENT_PROPERTIES_SCHEMA.BOOK_ADDED.safeParse({ method }).success).toBe(true)
    }
  })

  it('BOOK_ADDED відхиляє невідомий method', () => {
    expect(PRODUCT_EVENT_PROPERTIES_SCHEMA.BOOK_ADDED.safeParse({ method: 'OCR' }).success).toBe(
      false,
    )
  })

  it('зайві поля відхиляються для порожніх properties', () => {
    expect(PRODUCT_EVENT_PROPERTIES_SCHEMA.LOAN_REQUESTED.safeParse({ extra: 1 }).success).toBe(
      false,
    )
  })

  it('зайві поля відхиляються для BOOK_ADDED', () => {
    expect(
      PRODUCT_EVENT_PROPERTIES_SCHEMA.BOOK_ADDED.safeParse({
        method: 'MANUAL',
        isbn: '9786171262737',
      }).success,
    ).toBe(false)
  })
})

describe('productEventInputSchema (§6)', () => {
  const base = { subjectUserId: 'user-1', domainEntityId: 'copy-1' }

  it('приймає валідний BOOK_ADDED', () => {
    const result = productEventInputSchema.safeParse({
      ...base,
      type: 'BOOK_ADDED',
      properties: { method: 'MANUAL' },
    })

    expect(result.success).toBe(true)
  })

  it('відхиляє properties, що не відповідають type', () => {
    const result = productEventInputSchema.safeParse({
      ...base,
      type: 'LOAN_REQUESTED',
      properties: { method: 'MANUAL' },
    })

    expect(result.success).toBe(false)
  })

  it('відхиляє невідомий type', () => {
    const result = productEventInputSchema.safeParse({
      ...base,
      type: 'SEARCH_FOUND',
      properties: {},
    })

    expect(result.success).toBe(false)
  })

  it.each(['email', 'isbn', 'workId', 'loanId'])(
    'відхиляє довільне поле %s у properties',
    (field) => {
      const result = productEventInputSchema.safeParse({
        ...base,
        type: 'SIGNUP_COMPLETED',
        properties: { [field]: 'value' },
      })

      expect(result.success).toBe(false)
    },
  )

  it('відхиляє відсутній subjectUserId', () => {
    const result = productEventInputSchema.safeParse({
      domainEntityId: 'copy-1',
      type: 'SIGNUP_COMPLETED',
      properties: {},
    })

    expect(result.success).toBe(false)
  })

  it('відхиляє відсутній domainEntityId', () => {
    const result = productEventInputSchema.safeParse({
      subjectUserId: 'user-1',
      type: 'SIGNUP_COMPLETED',
      properties: {},
    })

    expect(result.success).toBe(false)
  })
})
