import { Logger } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import * as dedupeKeyModule from './dedupe-key'
import { computeDedupeKey } from './dedupe-key'
import type { ProductEventInput } from './product-event.types'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * docs/plan/stage-8-activation.md, §11 — мокається виклик Prisma-моделі, а не
 * якийсь штучний невалідний dedupeKey: `String`-колонка не має обмеження, яке
 * дало б природний конфлікт без реального дублювання ключа.
 */
function createService(): {
  service: AnalyticsService
  createMany: jest.Mock
} {
  const createMany = jest.fn().mockResolvedValue({ count: 1 })
  const prisma = { productEvent: { createMany } } as unknown as PrismaService

  return { service: new AnalyticsService(prisma), createMany }
}

const signupInput: ProductEventInput = {
  type: 'SIGNUP_COMPLETED',
  subjectUserId: 'user-1',
  domainEntityId: 'user-1',
  properties: {},
}

describe('AnalyticsService.record (§3, §6)', () => {
  // Деякі тести спіюють `Logger.prototype.warn` без явного `mockRestore()`:
  // без цього спай і його накопичений `mock.calls` пережили б тест і зіпсували
  // лічильники викликів у наступних.
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('валідний input створює правильний рядок', async () => {
    const { service, createMany } = createService()

    await service.record(signupInput)

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          type: 'SIGNUP_COMPLETED',
          properties: {},
          schemaVersion: 1,
          dedupeKey: computeDedupeKey('SIGNUP_COMPLETED', 'user-1', 'user-1'),
          subjectUserId: 'user-1',
        },
      ],
      skipDuplicates: true,
    })
  })

  it('завжди повертає resolved Promise<void>', async () => {
    const { service } = createService()

    await expect(service.record(signupInput)).resolves.toBeUndefined()
  })

  it('duplicate (skipDuplicates) — тиха no-op, без warning', async () => {
    const { service, createMany } = createService()
    createMany.mockResolvedValue({ count: 0 })
    const warn = jest.spyOn(Logger.prototype, 'warn')

    await service.record(signupInput)

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('Prisma rejection ловиться і повертає resolved Promise', async () => {
    const { service, createMany } = createService()
    createMany.mockRejectedValue(new Error('connection lost'))

    await expect(service.record(signupInput)).resolves.toBeUndefined()
  })

  it('warning при Prisma rejection не містить ID, properties чи dedupeKey', async () => {
    const { service, createMany } = createService()
    createMany.mockRejectedValue(new Error('connection lost'))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await service.record(signupInput)

    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message).not.toContain('user-1')
    expect(message).not.toContain(computeDedupeKey('SIGNUP_COMPLETED', 'user-1', 'user-1'))
    expect(message).toContain('SIGNUP_COMPLETED')
    warn.mockRestore()
  })

  it('невалідні properties не викликають Prisma й не кидаються назовні', async () => {
    const { service, createMany } = createService()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const invalid = {
      type: 'BOOK_ADDED',
      subjectUserId: 'user-1',
      domainEntityId: 'copy-1',
      properties: { method: 'OCR' },
    } as unknown as ProductEventInput

    await expect(service.record(invalid)).resolves.toBeUndefined()

    expect(createMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('відсутній subjectUserId не викликає Prisma й не кидається назовні', async () => {
    const { service, createMany } = createService()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const invalid = {
      type: 'SIGNUP_COMPLETED',
      domainEntityId: 'user-1',
      properties: {},
    } as unknown as ProductEventInput

    await expect(service.record(invalid)).resolves.toBeUndefined()
    expect(createMany).not.toHaveBeenCalled()
  })

  /**
   * `type` — довільний, ще не звірений із таксономією §4 на момент логування:
   * підставлений сюди user id чи чутливе значення не має права опинитися в логах як є.
   * Лейбл падає на літерал `UNKNOWN`, бо рядок не входить у сім дозволених типів.
   */
  it('невідомий type із умовним user ID/чутливим значенням не потрапляє в warning', async () => {
    const { service, createMany } = createService()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const sensitiveValue = 'user-id-private-value'
    const invalid = {
      type: sensitiveValue,
      subjectUserId: 'user-1',
      domainEntityId: 'copy-1',
      properties: {},
    } as unknown as ProductEventInput

    await expect(service.record(invalid)).resolves.toBeUndefined()

    expect(createMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message).not.toContain(sensitiveValue)
    expect(message).toContain('UNKNOWN')
    warn.mockRestore()
  })

  /**
   * §6/cleanup review: валідація, `computeDedupeKey` і `createMany` живуть в
   * одному try/catch — синхронний кидок ще ДО Prisma-виклику (тут: сам
   * `computeDedupeKey`) теж не має права вийти з `record()`.
   */
  it('синхронна внутрішня помилка до Prisma-виклику також не виходить із record()', async () => {
    const { service, createMany } = createService()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const dedupeSpy = jest.spyOn(dedupeKeyModule, 'computeDedupeKey').mockImplementation(() => {
      throw new Error('синхронний збій до Prisma')
    })

    await expect(service.record(signupInput)).resolves.toBeUndefined()

    expect(createMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message).toContain('SIGNUP_COMPLETED')
    expect(message).not.toContain('user-1')
    dedupeSpy.mockRestore()
    warn.mockRestore()
  })
})
