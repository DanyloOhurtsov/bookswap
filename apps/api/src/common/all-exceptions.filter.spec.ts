import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { API_ERROR_CODES, apiErrorSchema } from '@bookswap/shared'
import { AllExceptionsFilter } from './all-exceptions.filter'
import { ApiException } from './api.exception'

interface Captured {
  status: number
  body: unknown
}

function createHost(captured: Captured): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code
      return this
    },
    json(body: unknown) {
      captured.body = body
      return this
    },
  }

  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter
  let captured: Captured

  beforeEach(() => {
    filter = new AllExceptionsFilter()
    captured = { status: 0, body: undefined }
    // 5xx логуються навмисно — глушимо вивід, щоб не засмічувати прогін тестів.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('будь-яка відповідь відповідає спільній схемі apiErrorSchema', () => {
    filter.catch(new NotFoundException('nope'), createHost(captured))

    expect(() => apiErrorSchema.parse(captured.body)).not.toThrow()
  })

  describe('відповідність статусу коду', () => {
    const cases: ReadonlyArray<[HttpException, number, string]> = [
      [new BadRequestException('bad'), 400, API_ERROR_CODES.VALIDATION_ERROR],
      [new UnauthorizedException('no session'), 401, API_ERROR_CODES.UNAUTHORIZED],
      [new ForbiddenException('not yours'), 403, API_ERROR_CODES.FORBIDDEN],
      [new NotFoundException('missing'), 404, API_ERROR_CODES.NOT_FOUND],
      [new ConflictException('already exists'), 409, API_ERROR_CODES.CONFLICT],
      [
        new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS),
        429,
        API_ERROR_CODES.TOO_MANY_REQUESTS,
      ],
    ]

    it.each(cases)('%#: статус зберігається, код проставляється', (exception, status, code) => {
      filter.catch(exception, createHost(captured))

      expect(captured.status).toBe(status)
      expect(captured.body).toMatchObject({ code })
    })
  })

  it('немаповані 4xx отримують загальний клієнтський код, а не VALIDATION_ERROR', () => {
    filter.catch(
      new HttpException('unsupported', HttpStatus.UNSUPPORTED_MEDIA_TYPE),
      createHost(captured),
    )

    expect(captured.status).toBe(415)
    expect(captured.body).toMatchObject({ code: API_ERROR_CODES.BAD_REQUEST })
  })

  it('зберігає явно переданий машиночитний код доменного винятку', () => {
    filter.catch(
      new ApiException(API_ERROR_CODES.CONFLICT, 'Копія вже позичена', HttpStatus.CONFLICT),
      createHost(captured),
    )

    expect(captured.status).toBe(409)
    expect(captured.body).toEqual({ code: 'CONFLICT', message: 'Копія вже позичена' })
  })

  it('доносить машиночитні деталі доменного винятку до тіла відповіді', () => {
    // `EDITION_ISBN_TAKEN` віддає id наявного видання, щоб клієнт довів людину
    // до нього (§6.3, крок 3), а не просто показав помилку. Поле мусить пройти
    // крізь фільтр — саме тут воно колись мовчки губилося.
    filter.catch(
      new ApiException(
        API_ERROR_CODES.EDITION_ISBN_TAKEN,
        'Видання з таким ISBN уже є в каталозі',
        HttpStatus.CONFLICT,
        { editionId: 'edition-1' },
      ),
      createHost(captured),
    )

    expect(captured.status).toBe(409)
    expect(captured.body).toEqual({
      code: API_ERROR_CODES.EDITION_ISBN_TAKEN,
      message: 'Видання з таким ISBN уже є в каталозі',
      details: { editionId: 'edition-1' },
    })
  })

  it('порушення валідації йдуть у details, а не склеюються в message', () => {
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['title must be a string', 'rating must not be less than 1'],
        error: 'Bad Request',
      }),
      createHost(captured),
    )

    expect(captured.status).toBe(400)
    expect(captured.body).toEqual({
      code: API_ERROR_CODES.VALIDATION_ERROR,
      message: 'Validation failed',
      details: ['title must be a string', 'rating must not be less than 1'],
    })
  })

  describe('5xx', () => {
    it('невідома помилка стає 500 без деталей назовні', () => {
      filter.catch(new Error('connect ECONNREFUSED 127.0.0.1:5432'), createHost(captured))

      expect(captured.status).toBe(500)
      expect(captured.body).toEqual({
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      })
    })

    it('не розкриває ані оригінальне повідомлення, ані stack', () => {
      const exception = new Error('password=hunter2 at /srv/app/secret.ts:42')
      filter.catch(exception, createHost(captured))

      const serialized = JSON.stringify(captured.body)
      expect(serialized).not.toContain('hunter2')
      expect(serialized).not.toContain('secret.ts')
    })

    it('пише оригінальний stack у лог, а не у відповідь', () => {
      const logged = jest.spyOn(Logger.prototype, 'error')
      filter.catch(new Error('boom'), createHost(captured))

      expect(logged).toHaveBeenCalledTimes(1)
      expect(String(logged.mock.calls[0]?.[1])).toContain('boom')
    })

    it('зберігає нестандартний 5xx-статус, санітизуючи тіло', () => {
      filter.catch(
        new HttpException('upstream down', HttpStatus.SERVICE_UNAVAILABLE),
        createHost(captured),
      )

      expect(captured.status).toBe(503)
      expect(captured.body).toEqual({
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      })
    })
  })
})
