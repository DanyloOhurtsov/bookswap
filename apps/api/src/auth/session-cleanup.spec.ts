import { SessionCleanupService } from './session-cleanup.service'
import type { SessionService } from './session.service'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * Третій сервіс, який прокидається сам (§6.1), — і тому теж під вимикачем
 * `common/background.ts`. За змістом прибирання нікому не заважає: воно чіпає
 * лише прострочене. Але інваріант e2e — «поки йде файл, фонової роботи немає» —
 * має бути повним, інакше наступне розслідування знову починатиметься з питання
 * «а чи не воно?».
 */
describe('SessionCleanupService: розклад', () => {
  const prisma = {} as unknown as PrismaService
  const sessions = {} as unknown as SessionService

  const cleanupWith = (mode: 'enabled' | 'disabled') =>
    new SessionCleanupService(prisma, sessions, mode)

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("'disabled': таймер не заводиться", () => {
    cleanupWith('disabled').onModuleInit()

    expect(jest.getTimerCount()).toBe(0)
  })

  it("'enabled': таймер заводиться", () => {
    cleanupWith('enabled').onModuleInit()

    expect(jest.getTimerCount()).toBe(1)
  })
})
