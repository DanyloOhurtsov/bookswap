import {
  NOTIFICATION_TYPE,
  PREFERENCE_CHANNEL,
  defaultPreferenceEnabled,
  type ChannelAvailability,
  type NotificationChannels,
  type NotificationPreference,
  type NotificationType,
  type PreferenceChannel,
} from '@bookswap/shared'

/**
 * Логіка матриці §7.6 — окремим чистим модулем.
 *
 * Не «щоб було красиво»: `apps/web` тестує лише `.ts` у `app/lib`
 * (`jest.config.js`, `testEnvironment: 'node'`), тож усе, що варте перевірки,
 * мусить жити поза компонентом. А перевірки тут варте саме це — злиття
 * збережених клітинок із дефолтами й обчислення того, що надсилати назад:
 * помилка в жодному з двох не падає, вона тихо зберігає не те.
 */

export type PreferenceMatrix = Readonly<
  Record<NotificationType, Readonly<Record<PreferenceChannel, boolean>>>
>

/**
 * Відповідь сервера → матриця.
 *
 * Сервер віддає її повністю, але модуль однаково домальовує відсутні клітинки
 * дефолтами: контракт «повна матриця» не має ставати припущенням, від якого
 * сторінка ламається, якщо колись з'явиться новий тип події, а бек ще старий.
 */
export function toMatrix(
  preferences: readonly NotificationPreference[],
  telegramLinked: boolean,
): PreferenceMatrix {
  const stored = new Map(preferences.map((row) => [cellKey(row.type, row.channel), row.enabled]))
  const matrix = {} as Record<NotificationType, Record<PreferenceChannel, boolean>>

  for (const type of NOTIFICATION_TYPE) {
    const row = {} as Record<PreferenceChannel, boolean>

    for (const channel of PREFERENCE_CHANNEL) {
      row[channel] =
        stored.get(cellKey(type, channel)) ??
        defaultPreferenceEnabled(type, channel, { telegramLinked })
    }

    matrix[type] = row
  }

  return matrix
}

/** Перемикання однієї клітинки. Нова матриця, а не мутація — це стан React. */
export function toggleCell(
  matrix: PreferenceMatrix,
  type: NotificationType,
  channel: PreferenceChannel,
): PreferenceMatrix {
  return {
    ...matrix,
    [type]: { ...matrix[type], [channel]: !matrix[type][channel] },
  }
}

/**
 * Що саме надсилати в `PUT`.
 *
 * Тільки змінені клітинки, і це не оптимізація трафіку. Матриця цілком означала
 * б, що кожне збереження **матеріалізує** всі 30 рядків у базі — включно з тими,
 * яких людина не чіпала. Після цього зміна дефолту §7.6 (скажімо, новий тип
 * подій, критичний для флоу) не подіяла б на жодного наявного користувача: у всіх
 * уже лежав би явно збережений старий стан.
 */
export function changedCells(
  before: PreferenceMatrix,
  after: PreferenceMatrix,
): NotificationPreference[] {
  const changed: NotificationPreference[] = []

  for (const type of NOTIFICATION_TYPE) {
    for (const channel of PREFERENCE_CHANNEL) {
      if (before[type][channel] !== after[type][channel]) {
        changed.push({ type, channel, enabled: after[type][channel] })
      }
    }
  }

  return changed
}

export interface ChannelState extends ChannelAvailability {
  channel: PreferenceChannel
  /** Чи можна вмикати клітинки цієї колонки просто зараз. */
  editable: boolean
  /** Що показати під заголовком колонки. */
  detail: string
}

/**
 * Стан колонок для шапки таблиці.
 *
 * Три різні відповіді на «чому колонка не працює», і плутати їх не можна:
 *
 * - **не налаштовано на сервері** (`configured: false`) — жодна кнопка не
 *   допоможе, підключати нема до чого. Колонка недоступна, і пропонувати
 *   «Підключити» було б знущанням.
 * - **не підключено акаунтом** (`connected: false`) — це виправляється кнопкою,
 *   і саме її треба показати.
 * - **можна редагувати, але доставки поки не буде** — непідтверджена пошта.
 *   Вибір зберігається (§6.1 підтверджують тим самим листом, і забороняти
 *   налаштування наперед було б колом), але сказати про це чесно треба.
 *
 * `TELEGRAM` не редагується без прив'язки, бо `PUT` із `TELEGRAM: true` дає 409:
 * форма, яка дозволяє це натиснути, обіцяє те, чого система не зробить. `EMAIL`
 * редагується завжди — на відміну від Telegram, тут обіцянка збудеться, щойно
 * людина підтвердить адресу.
 */
export function channelStates(channels: NotificationChannels): ChannelState[] {
  return [
    { ...channels.inApp, channel: 'IN_APP', editable: true, detail: 'Список на цьому сайті' },
    {
      ...channels.email,
      channel: 'EMAIL',
      editable: true,
      detail: channels.email.verified
        ? channels.email.address
        : `${channels.email.address} — адресу не підтверджено, листи не надсилаються`,
    },
    {
      ...channels.telegram,
      channel: 'TELEGRAM',
      editable: channels.telegram.available,
      detail: telegramDetail(channels.telegram),
    },
  ]
}

function telegramDetail(telegram: ChannelAvailability): string {
  if (!telegram.configured) return 'Бот не налаштований на цьому сервері'

  return telegram.connected ? 'Підключено' : 'Не підключено'
}

/** Що показати замість кнопки над колонкою Telegram (§8, `PATCH /me/telegram`). */
export type TelegramAction = 'unlink' | 'connect' | 'unavailable'

/**
 * Яку дію показати над колонкою Telegram.
 *
 * `connected` перевіряється РАНІШЕ за `configured` навмисно. Сервер міг
 * перестати мати `TELEGRAM_BOT_TOKEN` вже ПІСЛЯ того, як людина підключилася:
 * `connected` — це `User.telegramChatId`, він не зникає разом із конфігом.
 * Якби `!configured` відсікав раніше, підключений акаунт назавжди бачив би
 * тільки «Недоступно» — без способу відв'язати вже наявний чат через UI,
 * хоча `DELETE /me/telegram` на бекенді працює незалежно від того, чи
 * налаштований бот зараз (§8 не вимагає `configured` для відв'язки).
 */
export function telegramChannelAction(telegram: ChannelAvailability): TelegramAction {
  if (telegram.connected) return 'unlink'
  if (!telegram.configured) return 'unavailable'

  return 'connect'
}

/**
 * Скільки лишилося жити посиланню на бота (§7.4: TTL 10 хвилин).
 *
 * `null` означає «вже протухло». Окреме значення, а не «0 секунд»: UI має не
 * показувати нуль на таймері, а прибрати посилання, бо натискання на нього
 * закінчиться відмовою бота.
 */
export function linkTimeLeftMs(expiresAt: string, now: number): number | null {
  const remaining = new Date(expiresAt).getTime() - now

  if (!Number.isFinite(remaining) || remaining <= 0) return null

  return remaining
}

/** `9:59` — рівно те, що людина очікує побачити на зворотному відліку. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

function cellKey(type: NotificationType, channel: PreferenceChannel): string {
  return `${type}:${channel}`
}
