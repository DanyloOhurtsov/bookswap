import { API_ERROR_CODES, apiErrorSchema } from './errors'

describe('apiErrorSchema', () => {
  it('приймає мінімальну помилку з машиночитним кодом', () => {
    const parsed = apiErrorSchema.parse({
      code: API_ERROR_CODES.NOT_FOUND,
      message: 'Cannot GET /api/v1/nope',
    })

    expect(parsed).toEqual({ code: 'NOT_FOUND', message: 'Cannot GET /api/v1/nope' })
  })

  it('пропускає необовʼязкові details', () => {
    const parsed = apiErrorSchema.parse({
      code: API_ERROR_CODES.VALIDATION_ERROR,
      message: 'Validation failed',
      details: ['title must be a string'],
    })

    expect(parsed.details).toEqual(['title must be a string'])
  })

  it('відхиляє невідомий код', () => {
    expect(() => apiErrorSchema.parse({ code: 'TEAPOT', message: 'nope' })).toThrow()
  })

  it('відхиляє порожнє повідомлення', () => {
    expect(() => apiErrorSchema.parse({ code: API_ERROR_CODES.CONFLICT, message: '' })).toThrow()
  })

  it('відхиляє відповідь без коду — саме він робить помилку машиночитною', () => {
    expect(() => apiErrorSchema.parse({ message: 'something went wrong' })).toThrow()
  })
})
