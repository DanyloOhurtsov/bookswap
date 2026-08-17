import { NOTIFICATION_TYPE } from '../domain/notification'
import {
  notificationListResponseSchema,
  notificationQueryRequestSchema,
  notificationSchema,
  readAllResponseSchema,
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
