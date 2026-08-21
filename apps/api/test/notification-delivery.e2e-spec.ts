import 'reflect-metadata'
import request from 'supertest'
import { ConfigService } from '@nestjs/config'
import { createTestApp, uniqueEmail, VALID_PASSWORD } from './auth.helpers'
import { registerAccount, url } from './loan.helpers'
import { NOTIFICATION_CHANNELS } from '../src/notifications/channels/notification-channel'
import { MAX_DELIVERY_ATTEMPTS } from '../src/notifications/notifications.constants'
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher.service'
import { NotificationPreferencesService } from '../src/notifications/notification-preferences.service'
import { NotificationsService } from '../src/notifications/notifications.service'
import { EMAIL_SENDER } from '../src/email/email-sender'
import { TELEGRAM_API } from '../src/telegram/telegram-api'
import { TelegramConfig } from '../src/telegram/telegram.config'
import { configuredTelegram } from './telegram.helpers'
import { PrismaService } from '../src/prisma/prisma.service'
import type { EmailMessage, EmailSender } from '../src/email/email-sender'
import type {
  TelegramApi,
  TelegramCallbackAnswer,
  TelegramMessageDraft,
  TelegramMessageEdit,
} from '../src/telegram/telegram-api'
import type { NotificationChannelSender } from '../src/notifications/channels/notification-channel'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * §7.3, правило 2: диспетчер, ретраї, незалежність каналів.
 *
 * Тести ганяють `dispatcher.run()` руками замість того, щоб чекати тик у 30
 * секунд, — той самий прийом, що в `session-cleanup.e2e-spec.ts`.
 *
 * Жодного зовнішнього HTTP: обидва транспорти підмінені керованими фейками. Це не
 * лише швидкість — §11 вимагає, щоб тести не ходили в мережу, а без цього
 * «перевірка ретраїв» перетворилася б на перевірку чужого аптайму.
 */
describe('Доставка сповіщень (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let notifications: NotificationsService
  let preferences: NotificationPreferencesService
  let dispatcher: NotificationDispatcher

  /** Керовані транспорти: кожен можна змусити падати рівно там, де треба. */
  const email = {
    sent: [] as EmailMessage[],
    fail: null as string | null,
    delayMs: 0,
  }
  const telegram = {
    sent: [] as TelegramMessageDraft[],
    fail: null as string | null,
  }

  const emailSender: EmailSender = {
    async send(message) {
      if (email.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, email.delayMs))
      if (email.fail !== null) throw new Error(email.fail)

      email.sent.push(message)
    },
  }

  const telegramApi: TelegramApi = {
    sendMessage(draft: TelegramMessageDraft): Promise<void> {
      if (telegram.fail !== null) return Promise.reject(new Error(telegram.fail))

      telegram.sent.push(draft)

      return Promise.resolve()
    },
    answerCallbackQuery: (_answer: TelegramCallbackAnswer) => Promise.resolve(),
    editMessageText: (_edit: TelegramMessageEdit) => Promise.resolve(),
  }

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(EMAIL_SENDER).useValue(emailSender)
        builder.overrideProvider(TELEGRAM_API).useValue(telegramApi)
        // Бот мусить бути «налаштованим», інакше `channelsFor` не створить жодної
        // TELEGRAM-доставки (§7.2: неналаштований канал не вдає робочий) — і
        // перевіряти незалежність каналів було б ні на чому.
        builder.overrideProvider(TelegramConfig).useValue(configuredTelegram())
      },
    })

    prisma = app.get(PrismaService)
    notifications = app.get(NotificationsService)
    preferences = app.get(NotificationPreferencesService)
    dispatcher = app.get(NotificationDispatcher)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Черга спорожняється перед кожним сценарієм. Диспетчер за визначенням
    // забирає ВСЕ, що дозріло, тож рядки, які попередній тест лишив у `PENDING`
    // (він же навмисно ламав канал), доїхали б у наступний і зіпсували б там
    // підрахунок відправок. Це властивість спільної тестової бази, а не коду.
    await prisma.notificationDelivery.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'SENT', sentAt: new Date() },
    })

    email.sent.length = 0
    email.fail = null
    email.delayMs = 0
    telegram.sent.length = 0
    telegram.fail = null
  })

  /**
   * Листи сповіщень, без листів акаунта.
   *
   * `registerAccount()` усередині кожного сценарію надсилає підтвердження адреси
   * тим самим `EmailSender` — це і є доказ §7.2 («відправка пишеться один раз і
   * використовується для всього»), але в підрахунку доставок воно лише шум.
   */
  function notificationMail(): EmailMessage[] {
    return email.sent.filter((message) => !message.body.includes('/verify-email'))
  }

  /**
   * Користувач, для якого доступні всі три канали.
   *
   * Пошта підтверджена явно: §6.1 не створює доставок на непідтверджену адресу,
   * а `registerAccount` лишає `emailVerified = false` — як і справжня реєстрація.
   */
  async function linkedUser(prefix: string): Promise<string> {
    const account = await registerAccount(app, prefix)

    await prisma.user.update({
      where: { id: account.id },
      data: { telegramChatId: `chat-${account.id}`, emailVerified: true },
    })

    return account.id
  }

  /** Свіжозареєстрований: адреса не підтверджена, Telegram не прив'язаний. */
  async function freshUser(prefix: string): Promise<string> {
    return (await registerAccount(app, prefix)).id
  }

  /** Створює подію разом із доставками — так само, як це робить перехід §5.1. */
  async function emit(userId: string): Promise<string> {
    await notifications.create({
      userId,
      type: 'LOAN_REQUESTED',
      payload: { loanId: `loan-${userId}`, copyId: `copy-${userId}` },
    })

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    return notification.id
  }

  function deliveries(notificationId: string) {
    return prisma.notificationDelivery.findMany({ where: { notificationId } })
  }

  /**
   * Канали рядків, за абеткою.
   *
   * Сортування — у JS, а не `orderBy: { channel: 'asc' }`: у PostgreSQL enum
   * упорядковується за порядком ОГОЛОШЕННЯ (`IN_APP, EMAIL, TELEGRAM`), а не за
   * абеткою, і очікування в тесті мовчки залежало б від порядку значень у схемі.
   */
  async function channelsOf(notificationId: string): Promise<string[]> {
    return (await deliveries(notificationId)).map((row) => row.channel).sort()
  }

  /** Повертає рядок у чергу: ретрай інакше чекав би на експоненційний backoff. */
  async function makeDue(notificationId: string): Promise<void> {
    await prisma.notificationDelivery.updateMany({
      where: { notificationId, status: 'PENDING' },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    })
  }

  describe('§7.3: подія → рядки доставки', () => {
    it('створює по рядку на кожен увімкнений канал', async () => {
      const userId = await linkedUser('delivery-all')
      const notificationId = await emit(userId)
      const rows = await deliveries(notificationId)

      expect(await channelsOf(notificationId)).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM'])
      expect(rows.every((row) => row.status === 'PENDING')).toBe(true)
      expect(rows.every((row) => row.attempts === 0)).toBe(true)
    })

    /**
     * §7.4: без `chat_id` слати нікуди. Рядок `PENDING`, який не має шансу
     * дійти, п'ять разів невдало спробував би й ліг у `FAILED` — тобто вдавав би
     * збій каналу там, де просто немає прив'язки.
     *
     * Те саме для непідтвердженої пошти (§6.1): доки людина не довела, що читає
     * цю скриньку, надсилати туди чужі імена й назви книжок не можна.
     */
    it('без прив’язки Telegram і без підтвердженої пошти лишається сам IN_APP', async () => {
      const channels = await channelsOf(await emit(await freshUser('delivery-nolink')))

      expect(channels).toEqual(['IN_APP'])
    })

    it('підтвердження пошти вмикає EMAIL за збереженими налаштуваннями', async () => {
      const userId = await freshUser('delivery-verify')

      expect(await channelsOf(await emit(userId))).toEqual(['IN_APP'])

      await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } })

      // Дефолт §7.6 для LOAN_REQUESTED — email увімкнений; після підтвердження
      // він застосовується без жодних дій користувача.
      expect(await channelsOf(await emit(userId))).toEqual(['EMAIL', 'IN_APP'])
    })

    it('вимкнений канал рядка не отримує (§7.6)', async () => {
      const userId = await linkedUser('delivery-off')

      await prisma.notificationPreference.create({
        data: { userId, type: 'LOAN_REQUESTED', channel: 'EMAIL', enabled: false },
      })

      expect(await channelsOf(await emit(userId))).toEqual(['IN_APP', 'TELEGRAM'])
    })
  })

  describe('§7.3, правило 1: подія й доставки — неподільні', () => {
    /**
     * Без переданої транзакції `NotificationsService.create` відкриває власну.
     * Саме так його викликає щоденний дайджест — і без транзакції збій між двома
     * записами лишав би подію, яку ніхто ніколи не побачить і не отримає: у базі
     * вона є, доставок немає, диспетчер її не бачить.
     */
    it('збій на створенні доставок відкочує й саму подію', async () => {
      const userId = await linkedUser('atomic-fail')
      const before = await prisma.notification.count({ where: { userId } })

      // Збій влаштовується МІЖ двома записами: `channelsFor` викликається вже
      // після вставки `Notification` і перед `createMany`. Підміняти сам
      // `prisma.notificationDelivery` марно — усередині транзакції запис іде
      // через `tx`, тобто інший об'єкт.
      const spy = jest
        .spyOn(preferences, 'channelsFor')
        .mockRejectedValueOnce(new Error('Симульований збій запису доставок'))

      await expect(
        notifications.create({
          userId,
          type: 'LOAN_REQUESTED',
          payload: { loanId: 'loan-atomic', copyId: 'copy-atomic' },
        }),
      ).rejects.toThrow('Симульований збій запису доставок')

      spy.mockRestore()

      // Ані події, ані доставок: або разом, або ніяк.
      expect(await prisma.notification.count({ where: { userId } })).toBe(before)
    })

    it('після відновлення запису та сама подія створюється повністю', async () => {
      const userId = await linkedUser('atomic-recover')
      const spy = jest
        .spyOn(preferences, 'channelsFor')
        .mockRejectedValueOnce(new Error('Симульований збій'))

      await expect(
        notifications.create({ userId, type: 'LOAN_REQUESTED', payload: {} }),
      ).rejects.toThrow()

      spy.mockRestore()

      const notificationId = await emit(userId)

      expect(await channelsOf(notificationId)).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM'])
    })

    /**
     * Не «жодна подія в базі не має нуля доставок» — це твердження перестало бути
     * інваріантом, щойно `IN_APP` став повноправною клітинкою матриці §7.6
     * (людина може вимкнути всі три канали, і в базі лишиться сама подія, без
     * жодного рядка доставки — це перевіряє
     * `notification-preferences.e2e-spec.ts`).
     *
     * Тут перевіряється вужче й правильне твердження: `createMany` доставок для
     * ПОДІЇ З УВІМКНЕНИМИ КАНАЛАМИ не буває частковим. Або всі очікувані рядки
     * створені разом із подією, або жодного — а не «два з трьох».
     */
    it('подія з увімкненими каналами отримує всі доставки одразу, без часткового набору', async () => {
      const userId = await linkedUser('atomic-full-set')
      const notificationId = await emit(userId)

      expect(await channelsOf(notificationId)).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM'])
    })
  })

  describe('§4.8: канали незалежні', () => {
    /**
     * Головна причина, чому `Notification` і `NotificationDelivery` — різні
     * таблиці: «у злитій таблиці невдала відправка в Telegram позначила б
     * сповіщення як провалене, хоча email дійшов».
     */
    it('падіння TELEGRAM не заважає EMAIL дійти', async () => {
      const userId = await linkedUser('delivery-split')
      const notificationId = await emit(userId)

      telegram.fail = 'Bot API недоступний'

      await dispatcher.run()

      const rows = await deliveries(notificationId)
      const byChannel = new Map(rows.map((row) => [row.channel, row]))

      expect(byChannel.get('EMAIL')?.status).toBe('SENT')
      expect(byChannel.get('EMAIL')?.sentAt).not.toBeNull()
      expect(byChannel.get('IN_APP')?.status).toBe('SENT')

      // Telegram лишається в черзі з власним лічильником і власною помилкою.
      expect(byChannel.get('TELEGRAM')?.status).toBe('PENDING')
      expect(byChannel.get('TELEGRAM')?.attempts).toBe(1)
      expect(byChannel.get('TELEGRAM')?.error).toContain('Bot API недоступний')
      expect(byChannel.get('TELEGRAM')?.sentAt).toBeNull()

      expect(notificationMail()).toHaveLength(1)
      expect(telegram.sent).toHaveLength(0)
    })

    it('падіння EMAIL не заважає TELEGRAM дійти', async () => {
      const userId = await linkedUser('delivery-split2')
      const notificationId = await emit(userId)

      email.fail = 'SMTP лежить'

      await dispatcher.run()

      const byChannel = new Map((await deliveries(notificationId)).map((row) => [row.channel, row]))

      expect(byChannel.get('TELEGRAM')?.status).toBe('SENT')
      expect(byChannel.get('EMAIL')?.status).toBe('PENDING')
      expect(byChannel.get('EMAIL')?.error).toContain('SMTP лежить')
      expect(telegram.sent).toHaveLength(1)
    })

    it('успішна доставка несе текст події й інлайн-кнопки (§7.4)', async () => {
      const userId = await linkedUser('delivery-text')

      await emit(userId)
      await dispatcher.run()

      expect(telegram.sent[0]?.buttons.map((button) => button.callbackData)).toEqual([
        `loan:approve:loan-${userId}`,
        `loan:reject:loan-${userId}`,
      ])
      // У листі кнопок немає, але текст мусить лишатися самодостатнім.
      expect(notificationMail()[0]?.subject).toContain('BookSwap')
      expect(notificationMail()[0]?.body).toContain('Погодьте або відхиліть запит.')
    })
  })

  describe('§7.3: ретраї й backoff', () => {
    it('кожна невдача інкрементує attempts і відсуває наступну спробу', async () => {
      const userId = await linkedUser('delivery-backoff')
      const notificationId = await emit(userId)

      telegram.fail = 'таймаут'

      await dispatcher.run()

      const first = (await deliveries(notificationId)).find((row) => row.channel === 'TELEGRAM')

      expect(first?.attempts).toBe(1)
      // Наступна спроба — у майбутньому, тож повторний тик рядок не візьме.
      expect(first?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())

      await dispatcher.run()

      const untouched = (await deliveries(notificationId)).find((row) => row.channel === 'TELEGRAM')

      expect(untouched?.attempts).toBe(1)

      await makeDue(notificationId)
      await dispatcher.run()

      const second = (await deliveries(notificationId)).find((row) => row.channel === 'TELEGRAM')

      expect(second?.attempts).toBe(2)
      // Затримка росте експоненційно — друга пауза довша за першу.
      expect(second?.nextAttemptAt.getTime()).toBeGreaterThan(first?.nextAttemptAt.getTime() ?? 0)
    })

    it('після п’ятої невдалої спроби рядок стає FAILED', async () => {
      const userId = await linkedUser('delivery-failed')
      const notificationId = await emit(userId)

      telegram.fail = 'бот заблокований користувачем'

      for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
        await makeDue(notificationId)
        await dispatcher.run()
      }

      const row = (await deliveries(notificationId)).find((r) => r.channel === 'TELEGRAM')

      expect(row?.status).toBe('FAILED')
      expect(row?.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
      expect(row?.error).toContain('бот заблокований')
      expect(row?.sentAt).toBeNull()

      // FAILED — термінальний стан: наступні тики його не чіпають.
      await makeDue(notificationId)
      await dispatcher.run()

      const after = (await deliveries(notificationId)).find((r) => r.channel === 'TELEGRAM')

      expect(after?.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
    })

    it('канал, що ожив, доходить — FAILED не настає передчасно', async () => {
      const userId = await linkedUser('delivery-recovers')
      const notificationId = await emit(userId)

      telegram.fail = 'тимчасово'
      await dispatcher.run()

      telegram.fail = null
      await makeDue(notificationId)
      await dispatcher.run()

      const row = (await deliveries(notificationId)).find((r) => r.channel === 'TELEGRAM')

      expect(row?.status).toBe('SENT')
      expect(row?.attempts).toBe(2)
      // Помилка попередньої спроби прибирається: рядок більше не бреше про стан.
      expect(row?.error).toBeNull()
    })
  })

  describe('§7.3: два воркери', () => {
    /**
     * Найважливіший тест файлу — і той, що ніколи не зламається локально, бо
     * розробник запускає один процес. Два диспетчери на одній базі не мають
     * права надіслати ту саму доставку двічі: захоплення рядків іде одним
     * `UPDATE … FOR UPDATE SKIP LOCKED`, тож конкурент не чекає на локу, а
     * пропускає зайнятий рядок.
     */
    it('не надсилають ту саму доставку двічі', async () => {
      const userIds = await Promise.all([
        linkedUser('delivery-race1'),
        linkedUser('delivery-race2'),
        linkedUser('delivery-race3'),
      ])

      for (const userId of userIds) await emit(userId)

      const pending = await prisma.notificationDelivery.count({
        where: { status: 'PENDING', notification: { userId: { in: userIds } } },
      })

      expect(pending).toBe(userIds.length * 3)

      // Затримка в каналі розтягує вікно гонки: без неї перший воркер устигав би
      // забрати все ще до того, як другий дійде до свого запиту.
      email.delayMs = 25

      const second = new NotificationDispatcher(
        prisma,
        app.get(ConfigService),
        app.get<readonly NotificationChannelSender[]>(NOTIFICATION_CHANNELS),
      )

      await Promise.all([dispatcher.run(), second.run()])

      const rows = await prisma.notificationDelivery.findMany({
        where: { notification: { userId: { in: userIds } } },
      })

      expect(rows).toHaveLength(userIds.length * 3)
      expect(rows.every((row) => row.status === 'SENT')).toBe(true)
      // Рівно одна спроба на рядок: другий воркер не брав те, що взяв перший.
      expect(rows.every((row) => row.attempts === 1)).toBe(true)

      // І, головне, рівно стільки відправок, скільки рядків, — не вдвічі більше.
      expect(notificationMail()).toHaveLength(userIds.length)
      expect(telegram.sent).toHaveLength(userIds.length)
    })

    it('порожня черга не коштує відправок', async () => {
      await dispatcher.run()

      expect(notificationMail()).toHaveLength(0)
      expect(telegram.sent).toHaveLength(0)
    })
  })

  describe('§7.2: спільний канал з листами акаунта', () => {
    /**
     * Причина, чому §7.2 узагалі бере пошту: «інфраструктура відправки потрібна
     * незалежно — для підтвердження пошти й скидання пароля… відправка пишеться
     * один раз і використовується для всього». Тут це видно буквально: лист
     * підтвердження й сповіщення виходять крізь один і той самий `EmailSender`.
     */
    it('підтвердження адреси йде тим самим EmailSender, що й сповіщення', async () => {
      const address = uniqueEmail('delivery-shared')

      await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: address, password: VALID_PASSWORD, displayName: 'Спільний канал' })
        .expect(201)

      expect(email.sent.some((message) => message.to === address)).toBe(true)
    })
  })
})
