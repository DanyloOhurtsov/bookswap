import { backoffDelayMs, isTerminalFailure, nextAttemptAfterFailure } from './delivery-backoff'
import {
  DELIVERY_BACKOFF_BASE_MS,
  DELIVERY_BACKOFF_MAX_MS,
  MAX_DELIVERY_ATTEMPTS,
} from './notifications.constants'

describe('backoffDelayMs (§7.3, правило 2)', () => {
  it('перша невдача чекає рівно базу', () => {
    expect(backoffDelayMs(1)).toBe(DELIVERY_BACKOFF_BASE_MS)
  })

  it('кожна наступна — удвічі довше', () => {
    expect(backoffDelayMs(2)).toBe(DELIVERY_BACKOFF_BASE_MS * 2)
    expect(backoffDelayMs(3)).toBe(DELIVERY_BACKOFF_BASE_MS * 4)
    expect(backoffDelayMs(4)).toBe(DELIVERY_BACKOFF_BASE_MS * 8)
  })

  it('затримка не перевищує стелю', () => {
    expect(backoffDelayMs(50)).toBe(DELIVERY_BACKOFF_MAX_MS)
  })

  /**
   * `attempts = 0` не має статися: захоплення рядка інкрементує лічильник **до**
   * спроби. Але поведінка на межі має бути визначеною, а не від'ємною затримкою,
   * яка поставила б `nextAttemptAt` у минуле й закрутила б ретраї в цикл без пауз.
   */
  it('нуль і від’ємне не дають затримки в минуле', () => {
    expect(backoffDelayMs(0)).toBe(DELIVERY_BACKOFF_BASE_MS)
    expect(backoffDelayMs(-3)).toBe(DELIVERY_BACKOFF_BASE_MS)
  })

  it('затримка монотонно зростає', () => {
    for (let attempts = 1; attempts < 10; attempts += 1) {
      expect(backoffDelayMs(attempts + 1)).toBeGreaterThanOrEqual(backoffDelayMs(attempts))
    }
  })
})

describe('isTerminalFailure', () => {
  it('до п’ятої спроби рядок лишається в черзі', () => {
    for (let attempts = 1; attempts < MAX_DELIVERY_ATTEMPTS; attempts += 1) {
      expect(isTerminalFailure(attempts)).toBe(false)
    }
  })

  it('п’ята невдала спроба — FAILED', () => {
    expect(isTerminalFailure(MAX_DELIVERY_ATTEMPTS)).toBe(true)
  })

  it('понад п’ять — теж термінально', () => {
    expect(isTerminalFailure(MAX_DELIVERY_ATTEMPTS + 1)).toBe(true)
  })
})

describe('nextAttemptAfterFailure', () => {
  it('відсуває від переданого «зараз», а не від системного часу', () => {
    const now = new Date('2026-06-01T10:00:00.000Z')

    expect(nextAttemptAfterFailure(now, 1).toISOString()).toBe(
      new Date(now.getTime() + DELIVERY_BACKOFF_BASE_MS).toISOString(),
    )
  })
})
