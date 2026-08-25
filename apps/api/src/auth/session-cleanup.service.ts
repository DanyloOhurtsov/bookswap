import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { BACKGROUND_MODE, type BackgroundMode } from '../common/background'
import { PrismaService } from '../prisma/prisma.service'
import { CLEANUP_INTERVAL_MS } from './auth.constants'
import { SessionService } from './session.service'

/**
 * Прибирання простроченого (§6.1).
 *
 * Прострочена сесія й так не працює — `SessionService.validate` звіряє `expiresAt`
 * на кожному запиті, тож це не питання безпеки. Це питання того, щоб таблиця не
 * росла вічно рядками, які вже нічого не означають.
 *
 * Звичайний інтервал, а не крон-планувальник: одна періодична задача не варта
 * ще однієї залежності. Коли етап 3 принесе воркер доставки сповіщень і щоденний
 * дайджест (§7.3, §7.5), планувальник з'явиться разом із ними.
 */
@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name)
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    /** Замовчування діє лише для ручного `new`; Nest бере значення з провайдера. */
    @Inject(BACKGROUND_MODE) private readonly background: BackgroundMode = 'enabled',
  ) {}

  onModuleInit(): void {
    // Прибирання нікому не заважає за змістом (воно чіпає лише прострочене), але
    // це та сама фонова робота по спільній базі: в e2e її розклад вимкнений
    // разом з рештою, щоб інваріант «поки йде файл, фону немає» був повним.
    // `run()` лишається публічним — `session-cleanup.e2e-spec.ts` кличе його сам.
    if (this.background === 'disabled') return

    this.timer = setInterval(() => {
      void this.run()
    }, CLEANUP_INTERVAL_MS)

    // Без unref() таймер тримає процес живим — і `jest` після e2e не завершується.
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
  }

  /**
   * Помилка тут не має валити застосунок: наступний тик спробує знову.
   * Публічний, щоб тест міг викликати прибирання, не чекаючи чверть години.
   */
  async run(now = new Date()): Promise<void> {
    try {
      const sessions = await this.sessions.deleteExpired(now)
      const verifications = await this.prisma.emailVerificationToken.deleteMany({
        where: { expiresAt: { lte: now } },
      })
      const resets = await this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lte: now } },
      })

      const total = sessions + verifications.count + resets.count

      if (total > 0) {
        this.logger.log(
          `Прибрано прострочене: сесій ${String(sessions)}, ` +
            `підтверджень ${String(verifications.count)}, скидань ${String(resets.count)}`,
        )
      }
    } catch (error) {
      this.logger.error('Не вдалося прибрати прострочене', error)
    }
  }
}
