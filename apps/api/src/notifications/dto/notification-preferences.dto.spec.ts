// `@Type()` на вкладеному масиві читає метадані ще на етапі декорування, тож
// поліфіл потрібен до імпорту DTO. У застосунку його підключає сам Nest.
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import {
  NOTIFICATION_PREFERENCE_LIMITS,
  updateNotificationPreferencesRequestSchema,
} from '@bookswap/shared'
import { UpdateNotificationPreferencesDto } from './notification-preferences.dto'

/** Той самий тест парності, що й для решти DTO (§11). */
function acceptedByDto(payload: unknown): boolean {
  const instance = plainToInstance(UpdateNotificationPreferencesDto, payload)

  return (
    validateSync(instance as object, { whitelist: true, forbidNonWhitelisted: true }).length === 0
  )
}

const cell = { type: 'LOAN_REQUESTED', channel: 'EMAIL', enabled: true }

describe('UpdateNotificationPreferencesDto ↔ updateNotificationPreferencesRequestSchema', () => {
  const cases: { name: string; payload: unknown; valid: boolean }[] = [
    { name: 'одна клітинка', payload: { preferences: [cell] }, valid: true },
    {
      name: 'той самий тип у двох каналах',
      payload: {
        preferences: [cell, { type: 'LOAN_REQUESTED', channel: 'TELEGRAM', enabled: false }],
      },
      valid: true,
    },
    { name: 'порожній список', payload: { preferences: [] }, valid: false },
    { name: 'без поля', payload: {}, valid: false },
    {
      name: 'дубльована клітинка',
      payload: { preferences: [cell, { ...cell, enabled: false }] },
      valid: false,
    },
    {
      // §7.6 покриває всі канали §4.8: in-app теж можна вимкнути.
      name: 'IN_APP як клітинка матриці',
      payload: { preferences: [{ ...cell, channel: 'IN_APP' }] },
      valid: true,
    },
    {
      name: 'невідомий канал',
      payload: { preferences: [{ ...cell, channel: 'SMS' }] },
      valid: false,
    },
    {
      name: 'невідомий тип',
      payload: { preferences: [{ ...cell, type: 'LOAN_EATEN' }] },
      valid: false,
    },
    {
      name: 'enabled рядком',
      payload: { preferences: [{ ...cell, enabled: 'true' }] },
      valid: false,
    },
    {
      name: 'більше клітинок, ніж є в матриці',
      payload: {
        preferences: Array.from(
          { length: NOTIFICATION_PREFERENCE_LIMITS.matrixSize + 1 },
          () => cell,
        ),
      },
      valid: false,
    },
  ]

  it('однаково приймає й відхиляє однакові дані', () => {
    for (const { name, payload, valid } of cases) {
      const byZod = updateNotificationPreferencesRequestSchema.safeParse(payload).success
      const byDto = acceptedByDto(payload)

      expect({ name, byZod, byDto }).toEqual({ name, byZod: valid, byDto: valid })
    }
  })

  /**
   * Розмір матриці рахується зі списків у `shared`, а не константою «30»: новий
   * тип події має розширювати ліміт сам, інакше перший же PUT після його появи
   * почав би впиратися в стелю, яку ніхто не рухав.
   */
  it('ліміт дорівнює розміру матриці', () => {
    const full = Array.from({ length: NOTIFICATION_PREFERENCE_LIMITS.matrixSize }, () => cell)

    // Дублікати ловить інше правило — тут перевіряється саме довжина.
    expect(
      plainToInstance(UpdateNotificationPreferencesDto, { preferences: full }).preferences,
    ).toHaveLength(NOTIFICATION_PREFERENCE_LIMITS.matrixSize)
  })
})
