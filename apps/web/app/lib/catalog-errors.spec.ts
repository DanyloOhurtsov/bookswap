import type { ApiError } from '@bookswap/shared'
import { ApiRequestError } from './api'
import { describeAddBookError } from './catalog-errors'

const apiError = (status: number, error: ApiError): ApiRequestError =>
  new ApiRequestError(status, error)

describe('describeAddBookError', () => {
  it('429 — зрозуміле повідомлення про rate limit, а не сирий текст ThrottlerException', () => {
    const error = apiError(429, {
      code: 'TOO_MANY_REQUESTS',
      message: 'ThrottlerException: Too Many Requests',
    })

    expect(describeAddBookError(error)).toBe(
      'Забагато запитів поспіль. Зачекайте хвилину і спробуйте ще раз.',
    )
  })

  it('504 — повідомлення про таймаут провайдера з порадою заповнити вручну', () => {
    const error = apiError(504, {
      code: 'CATALOG_LOOKUP_TIMEOUT',
      message: 'Зовнішній провайдер не відповів вчасно',
    })

    expect(describeAddBookError(error)).toContain('заповнити форму вручну')
  })

  it('502 — повідомлення про помилку провайдера', () => {
    const error = apiError(502, {
      code: 'CATALOG_LOOKUP_PROVIDER_ERROR',
      message: 'Зовнішній провайдер повернув помилку: 500',
    })

    expect(describeAddBookError(error)).toBe(
      'Зовнішній сервіс автозаповнення зараз недоступний. Можна заповнити форму вручну.',
    )
  })

  it('404 — ISBN не знайдено у провайдера', () => {
    const error = apiError(404, {
      code: 'CATALOG_LOOKUP_NOT_FOUND',
      message: 'Зовнішній провайдер не знає ISBN 9780000000002',
    })

    expect(describeAddBookError(error)).toBe(
      'За цим ISBN у зовнішньому джерелі нічого не знайшлося. Можна заповнити форму вручну.',
    )
  })

  it('код без спеціального мапінгу — минає повідомлення з бекенду як є', () => {
    const error = apiError(409, {
      code: 'EDITION_ISBN_TAKEN',
      message: 'ISBN уже належить іншому виданню',
    })

    expect(describeAddBookError(error)).toBe('ISBN уже належить іншому виданню')
  })

  it('не ApiRequestError (мережа впала) — той самий текст, що й describeError', () => {
    expect(describeAddBookError(new TypeError('fetch failed'))).toContain(
      'Не вдалося звʼязатися з API',
    )
  })
})
