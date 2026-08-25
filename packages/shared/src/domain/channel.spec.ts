import { CHANNEL, DELIVERY_STATUS, PREFERENCE_CHANNEL, channelSchema } from './channel'

describe('Channel', () => {
  it('відповідає §4.8', () => {
    expect([...CHANNEL].sort()).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM'])
  })

  it.each(CHANNEL)('приймає %s', (channel) => {
    expect(channelSchema.parse(channel)).toBe(channel)
  })

  it('відхиляє невідомий канал', () => {
    expect(channelSchema.safeParse('SMS').success).toBe(false)
  })
})

describe('PREFERENCE_CHANNEL', () => {
  /**
   * Матриця §7.6 покриває всі канали §4.8 — `IN_APP` теж.
   *
   * Спокуса виключити його виглядає нешкідливою («це ж просто список на
   * сторінці»), але забирає в людини цілком осмислений вибір: отримувати
   * сповіщення лише в Telegram і не бачити лічильника непрочитаних. Цей тест
   * стоїть тут, щоб його не виключили вдруге.
   */
  it('містить усі канали §4.8, включно з IN_APP', () => {
    expect([...PREFERENCE_CHANNEL].sort()).toEqual([...CHANNEL].sort())
    expect([...PREFERENCE_CHANNEL]).toContain('IN_APP')
  })
})

describe('DeliveryStatus', () => {
  it('відповідає §4.8', () => {
    expect([...DELIVERY_STATUS].sort()).toEqual(['FAILED', 'PENDING', 'SENT'])
  })
})
