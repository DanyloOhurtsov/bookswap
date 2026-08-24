import { NotificationDigestService } from './notification-digest.service'
import { NotificationDispatcher } from './notification-dispatcher.service'
import type { ConfigService } from '@nestjs/config'
import type { NotificationsService } from './notifications.service'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * Вимикач фонового виконання (`common/background.ts`).
 *
 * Обидва шляхи, якими прохід стартує сам, мусять бути закриті одночасно —
 * розклад і поштовх. Половинчастий вимикач уже перевірявся вручну й нічого не
 * дав: e2e-набір лишався флакі саме тому, що `wake()` іде повз таймер.
 *
 * Тут не потрібні ні PostgreSQL, ні Nest: обидва сервіси будуються напряму, а
 * предмет перевірки — рівно дві гілки в `onModuleInit()` і `trigger()`.
 */
describe('Режим фонового виконання', () => {
  const prisma = {} as unknown as PrismaService
  const config = {} as unknown as ConfigService
  const notifications = {} as unknown as NotificationsService

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('NotificationDispatcher', () => {
    const dispatcherWith = (mode: 'enabled' | 'disabled') =>
      new NotificationDispatcher(prisma, config, [], mode)

    it("'disabled': onModuleInit не заводить таймера", () => {
      dispatcherWith('disabled').onModuleInit()

      expect(jest.getTimerCount()).toBe(0)
    })

    it("'disabled': wake() не запускає проходу", () => {
      const dispatcher = dispatcherWith('disabled')
      const run = jest.spyOn(dispatcher, 'run').mockResolvedValue(0)

      dispatcher.onModuleInit()
      dispatcher.wake()

      expect(run).not.toHaveBeenCalled()
    })

    it("'enabled': заводить таймер і слухає wake()", () => {
      const dispatcher = dispatcherWith('enabled')
      const run = jest.spyOn(dispatcher, 'run').mockResolvedValue(0)

      dispatcher.onModuleInit()

      expect(jest.getTimerCount()).toBe(1)

      dispatcher.wake()

      expect(run).toHaveBeenCalledTimes(1)
    })
  })

  describe('NotificationDigestService', () => {
    const digestWith = (mode: 'enabled' | 'disabled') =>
      new NotificationDigestService(prisma, notifications, mode)

    /**
     * §7.5 вимагає, щоб перший прохід стався одразу на `onModuleInit`, а не за
     * годину. Вимкнений режим не має права робити цей прохід у чужому
     * e2e-файлі: дайджест сканує ВСІ HANDED_OVER-лоани спільної бази.
     */
    it("'disabled': ні таймера, ні негайного першого проходу", () => {
      const digest = digestWith('disabled')
      const run = jest.spyOn(digest, 'run').mockResolvedValue(0)

      digest.onModuleInit()

      expect(jest.getTimerCount()).toBe(0)
      expect(run).not.toHaveBeenCalled()
    })

    it("'disabled': wake() не запускає проходу", () => {
      const digest = digestWith('disabled')
      const run = jest.spyOn(digest, 'run').mockResolvedValue(0)

      digest.wake()

      expect(run).not.toHaveBeenCalled()
    })

    it("'enabled': таймер, негайний перший прохід і робочий wake()", () => {
      const digest = digestWith('enabled')
      const run = jest.spyOn(digest, 'run').mockResolvedValue(0)

      digest.onModuleInit()

      expect(jest.getTimerCount()).toBe(1)
      expect(run).toHaveBeenCalledTimes(1)

      digest.wake()

      expect(run).toHaveBeenCalledTimes(2)
    })
  })
})
