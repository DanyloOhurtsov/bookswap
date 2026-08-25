import { PREFERENCE_CHANNEL } from '../domain/channel'
import { NOTIFICATION_TYPE } from '../domain/notification'
import {
  NOTIFICATION_PREFERENCE_LIMITS,
  notificationListResponseSchema,
  notificationPreferenceSchema,
  notificationPreferencesResponseSchema,
  notificationQueryRequestSchema,
  notificationSchema,
  readAllResponseSchema,
  telegramLinkResponseSchema,
  updateNotificationPreferencesRequestSchema,
} from './notification'

const rawNotification = {
  id: 'notification-1',
  type: 'LOAN_REQUESTED',
  payload: { loanId: 'loan-1', copyId: 'copy-1', actorId: 'user-oles' },
  readAt: null,
  createdAt: '2026-06-01T10:00:00.000Z',
}

describe('notificationSchema', () => {
  it.each([...NOTIFICATION_TYPE])('приймає тип %s', (type) => {
    expect(notificationSchema.parse({ ...rawNotification, type }).type).toBe(type)
  })

  it('payload — рядок-до-рядка: там самі ідентифікатори (§4.8)', () => {
    expect(notificationSchema.parse(rawNotification).payload.loanId).toBe('loan-1')
    expect(
      notificationSchema.safeParse({ ...rawNotification, payload: { count: 3 } }).success,
    ).toBe(false)
    expect(
      notificationSchema.safeParse({ ...rawNotification, payload: { nested: { a: 'b' } } }).success,
    ).toBe(false)
  })

  it('прочитане позначається часом, а не прапорцем', () => {
    // Час відповідає й на «чи прочитано», і на «коли»; булеве — лише на перше.
    expect(notificationSchema.parse(rawNotification).readAt).toBeNull()
    expect(
      notificationSchema.parse({ ...rawNotification, readAt: '2026-06-02T10:00:00.000Z' }).readAt,
    ).toBe('2026-06-02T10:00:00.000Z')
    expect(notificationSchema.safeParse({ ...rawNotification, readAt: true }).success).toBe(false)
  })

  it('LOAN_CANCELLED приймається — він потрібен для APPROVED → CANCELLED (§5.1)', () => {
    expect(notificationSchema.parse({ ...rawNotification, type: 'LOAN_CANCELLED' }).type).toBe(
      'LOAN_CANCELLED',
    )
  })
})

describe('notificationQueryRequestSchema', () => {
  it('фільтр опційний', () => {
    expect(notificationQueryRequestSchema.parse({})).toEqual({})
  })

  it('перетворює рядок query-параметра на булеве', () => {
    expect(notificationQueryRequestSchema.parse({ unread: 'true' }).unread).toBe(true)
    expect(notificationQueryRequestSchema.parse({ unread: 'false' }).unread).toBe(false)
  })

  it('приймає рівно два рядки — жодних синонімів', () => {
    // Ширша множина («1», «yes», «on») мусила б дослівно повторитися в
    // `class-validator`, і перша ж розбіжність пройшла б непоміченою.
    for (const value of ['1', '0', 'yes', 'no', 'on', '', 'TRUE']) {
      expect(notificationQueryRequestSchema.safeParse({ unread: value }).success).toBe(false)
    }
  })
})

describe('notificationListResponseSchema', () => {
  it('лічильник непрочитаних приходить окремо від списку', () => {
    // Він потрібен навігації незалежно від того, яку вкладку відкрито, — тому не
    // виводиться з довжини масиву.
    const response = notificationListResponseSchema.parse({
      notifications: [rawNotification],
      unreadCount: 7,
    })

    expect(response.notifications).toHaveLength(1)
    expect(response.unreadCount).toBe(7)
  })

  it('відʼємний лічильник не приймається', () => {
    expect(
      notificationListResponseSchema.safeParse({ notifications: [], unreadCount: -1 }).success,
    ).toBe(false)
  })
})

describe('readAllResponseSchema', () => {
  it('віддає, скільки рядків справді змінилося', () => {
    expect(readAllResponseSchema.parse({ updated: 0 }).updated).toBe(0)
    expect(readAllResponseSchema.safeParse({ updated: 1.5 }).success).toBe(false)
  })
})

describe('notificationPreferencesResponseSchema (§7.6)', () => {
  const channels = {
    inApp: { configured: true, connected: true, available: true },
    email: {
      address: 'marta@example.com',
      verified: true,
      configured: true,
      connected: true,
      available: true,
    },
    telegram: { configured: true, connected: false, available: false },
  }

  it('віддає матрицю разом зі станом каналів', () => {
    const response = notificationPreferencesResponseSchema.parse({
      preferences: [{ type: 'LOAN_REQUESTED', channel: 'EMAIL', enabled: true }],
      channels,
    })

    expect(response.preferences).toHaveLength(1)
    expect(response.channels.telegram.connected).toBe(false)
  })

  /**
   * `configured` і `connected` — різні питання, і клієнт мусить бачити їх окремо:
   * непідключений канал показує кнопку «Підключити», неналаштований — не показує
   * нічого, бо підключати нема до чого. Одне поле `available` змусило б UI писати
   * «підключіть Telegram» там, де підключати нема до чого.
   */
  it('розрізняє «сервер не вміє» і «акаунт не підключив»', () => {
    const unconfigured = notificationPreferencesResponseSchema.parse({
      preferences: [],
      channels: {
        ...channels,
        telegram: { configured: false, connected: false, available: false },
      },
    })

    expect(unconfigured.channels.telegram.configured).toBe(false)
    expect(unconfigured.channels.telegram.available).toBe(false)
  })

  /**
   * `IN_APP` — повноправна клітинка §7.6, а не «завжди увімкнено». Людина має
   * право отримувати сповіщення лише в Telegram і не бачити лічильника
   * непрочитаних.
   */
  it('IN_APP — повноправна клітинка матриці', () => {
    expect(
      notificationPreferencesResponseSchema.safeParse({
        preferences: [{ type: 'LOAN_REQUESTED', channel: 'IN_APP', enabled: false }],
        channels,
      }).success,
    ).toBe(true)
  })

  it.each([...PREFERENCE_CHANNEL])('приймає канал %s', (channel) => {
    expect(
      notificationPreferenceSchema.parse({ type: 'LOAN_OVERDUE', channel, enabled: false }),
    ).toEqual({ type: 'LOAN_OVERDUE', channel, enabled: false })
  })

  it('адреса пошти має бути адресою', () => {
    expect(
      notificationPreferencesResponseSchema.safeParse({
        preferences: [],
        channels: { ...channels, email: { ...channels.email, address: 'не адреса' } },
      }).success,
    ).toBe(false)
  })
})

describe('updateNotificationPreferencesRequestSchema (§8)', () => {
  it('приймає часткову матрицю — неназвані клітинки лишаються як були', () => {
    const parsed = updateNotificationPreferencesRequestSchema.parse({
      preferences: [{ type: 'LOAN_RETURNED', channel: 'EMAIL', enabled: true }],
    })

    expect(parsed.preferences).toHaveLength(1)
  })

  /**
   * Дублікат — не «перемагає останній», а 400: два різні значення однієї клітинки
   * в одному тілі означають, що клієнт зібрав форму неправильно, і зберегти
   * будь-яке з них — це зберегти не те, що людина бачила на екрані.
   */
  it('відхиляє двічі названу клітинку', () => {
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        preferences: [
          { type: 'LOAN_RETURNED', channel: 'EMAIL', enabled: true },
          { type: 'LOAN_RETURNED', channel: 'EMAIL', enabled: false },
        ],
      }).success,
    ).toBe(false)
  })

  it('той самий тип у різних каналах дублікатом не є', () => {
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        preferences: [
          { type: 'LOAN_RETURNED', channel: 'EMAIL', enabled: true },
          { type: 'LOAN_RETURNED', channel: 'TELEGRAM', enabled: false },
        ],
      }).success,
    ).toBe(true)
  })

  it('порожній список і матриця більша за можливу не приймаються', () => {
    expect(updateNotificationPreferencesRequestSchema.safeParse({ preferences: [] }).success).toBe(
      false,
    )

    const tooMany = Array.from({ length: NOTIFICATION_PREFERENCE_LIMITS.matrixSize + 1 }, () => ({
      type: 'LOAN_RETURNED',
      channel: 'EMAIL',
      enabled: true,
    }))

    expect(
      updateNotificationPreferencesRequestSchema.safeParse({ preferences: tooMany }).success,
    ).toBe(false)
  })
})

describe('telegramLinkResponseSchema (§7.4)', () => {
  it('віддає deep link і момент, коли він протухне', () => {
    const parsed = telegramLinkResponseSchema.parse({
      deepLink: 'https://t.me/bookswap_bot?start=abc',
      expiresAt: '2026-06-01T10:10:00.000Z',
    })

    expect(parsed.deepLink).toContain('?start=')
  })

  it('не-URL посилання не приймається', () => {
    expect(
      telegramLinkResponseSchema.safeParse({
        deepLink: 't.me/bookswap_bot?start=abc',
        expiresAt: '2026-06-01T10:10:00.000Z',
      }).success,
    ).toBe(false)
  })
})
