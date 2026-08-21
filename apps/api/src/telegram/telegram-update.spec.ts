import {
  chatIdOf,
  parseLoanCallback,
  parseStartToken,
  telegramUpdateSchema,
} from './telegram-update'

describe('parseStartToken (§7.4)', () => {
  it('дістає токен із /start <token>', () => {
    expect(parseStartToken('/start AbC-123_xyz')).toBe('AbC-123_xyz')
  })

  it('приймає форму з іменем бота', () => {
    expect(parseStartToken('/start@bookswap_bot AbC-123')).toBe('AbC-123')
  })

  it('голий /start — не помилка, а відкриття бота з пошуку', () => {
    expect(parseStartToken('/start')).toBeNull()
    expect(parseStartToken('/start ')).toBeNull()
  })

  it('інші повідомлення ігноруються', () => {
    expect(parseStartToken('привіт')).toBeNull()
    expect(parseStartToken('/help')).toBeNull()
    expect(parseStartToken(undefined)).toBeNull()
  })

  /** Токен — один аргумент. Два означають, що це не наша команда. */
  it('не бере перший із кількох аргументів', () => {
    expect(parseStartToken('/start token1 token2')).toBeNull()
  })
})

describe('parseLoanCallback (§7.4)', () => {
  it('розбирає approve і reject', () => {
    expect(parseLoanCallback('loan:approve:clx123')).toEqual({
      action: 'approve',
      loanId: 'clx123',
    })
    expect(parseLoanCallback('loan:reject:clx123')).toEqual({ action: 'reject', loanId: 'clx123' })
  })

  /**
   * Множина дій вужча за `LOAN_ACTIONS` навмисно: кнопка під старим
   * повідомленням не має давати «втрачено» чи «повернуто» без контексту.
   */
  it.each(['hand_over', 'return', 'mark_lost', 'cancel'])(
    'дію %s з кнопки не приймає',
    (action) => {
      expect(parseLoanCallback(`loan:${action}:clx123`)).toBeNull()
    },
  )

  it.each([
    'loan:approve',
    'loan:approve:',
    'loan::clx123',
    'friend:approve:clx123',
    'loan:approve:clx123:extra',
    'loan:approve:clx 123',
    'loan:approve:\'; DROP TABLE "Loan"; --',
    '',
  ])('відхиляє %s', (data) => {
    expect(parseLoanCallback(data)).toBeNull()
  })

  it('відхиляє відсутню data', () => {
    expect(parseLoanCallback(undefined)).toBeNull()
  })

  it('обмежує довжину id', () => {
    expect(parseLoanCallback(`loan:approve:${'c'.repeat(65)}`)).toBeNull()
    expect(parseLoanCallback(`loan:approve:${'c'.repeat(64)}`)).not.toBeNull()
  })
})

describe('telegramUpdateSchema', () => {
  /**
   * Головна вимога до схеми — **не** відхиляти незнайомі поля: Telegram додає їх
   * постійно, а сувора схема перетворила б кожне таке доповнення на мовчазну
   * втрату оновлень.
   */
  it('пропускає невідомі поля', () => {
    const parsed = telegramUpdateSchema.safeParse({
      update_id: 1,
      message: {
        message_id: 7,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'Марта' },
        text: '/start abc',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.message?.text).toBe('/start abc')
  })

  it('приймає колбек без message — Telegram так позначає старі повідомлення', () => {
    const parsed = telegramUpdateSchema.safeParse({
      callback_query: { id: 'q1', from: { id: 42 }, data: 'loan:approve:clx' },
    })

    expect(parsed.success).toBe(true)
  })

  it('вимагає числовий chat.id', () => {
    expect(
      telegramUpdateSchema.safeParse({
        message: { message_id: 1, chat: { id: '42' }, text: '/start' },
      }).success,
    ).toBe(false)
  })

  it('порожнє тіло — валідне оновлення без корисного вмісту', () => {
    expect(telegramUpdateSchema.safeParse({}).success).toBe(true)
  })
})

describe('chatIdOf', () => {
  it('переводить число Telegram у рядок колонки User.telegramChatId', () => {
    expect(chatIdOf(42)).toBe('42')
    expect(chatIdOf(-1_001_234_567_890)).toBe('-1001234567890')
  })
})
