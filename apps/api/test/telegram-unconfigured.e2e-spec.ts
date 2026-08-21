import 'reflect-metadata'
import request from 'supertest'
import {
  API_ERROR_CODES,
  apiErrorSchema,
  notificationPreferencesResponseSchema,
} from '@bookswap/shared'
import { createTestApp } from './auth.helpers'
import { registerAccount, url } from './loan.helpers'
import { FakeTelegramApi } from '../src/telegram/fake-telegram-api'
import { TELEGRAM_API } from '../src/telegram/telegram-api'
import { UnavailableTelegramApi } from '../src/telegram/unavailable-telegram-api'
import { NotificationsService } from '../src/notifications/notifications.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher.service'
import type { TelegramApi } from '../src/telegram/telegram-api'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * §7.2: канал, якого немає, не має вдавати робочий.
 *
 * Тестове оточення бота не налаштовує (`TELEGRAM_BOT_TOKEN` немає), тож це і є
 * стан «сервер не вміє Telegram» — той самий, у якому опиняється прод, куди
 * забули покласти змінні.
 *
 * Найдорожча помилка тут — фейковий транспорт, що повертає успіх: доставка стає
 * `SENT`, хоча нікому нічого не надіслано, черга §7.3 перестає означати те, що
 * означає, а дізнаються про це зі скарги людини, яка не отримала запит на власну
 * книжку.
 */
describe('Telegram без конфігурації (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let notifications: NotificationsService
  let dispatcher: NotificationDispatcher

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    notifications = app.get(NotificationsService)
    dispatcher = app.get(NotificationDispatcher)
  })

  afterAll(async () => {
    await app.close()
  })

  const codeOf = (body: unknown): string => apiErrorSchema.parse(body).code

  describe('§7.2: транспорт', () => {
    /** Поза production фейк лишається — інакше свіжий клон непроходимий. */
    it('поза production підіймається фейковий транспорт', () => {
      expect(app.get<TelegramApi>(TELEGRAM_API)).toBeInstanceOf(FakeTelegramApi)
    })

    /**
     * У production фейк заборонений. Перевіряється сам транспорт, а не рядок у
     * конфізі: саме він вирішує, стане доставка `SENT` чи ні.
     */
    it('транспорт-заглушка production відмовляє, а не вдає успіх', async () => {
      const unavailable = new UnavailableTelegramApi()

      await expect(
        unavailable.sendMessage({ chatId: '1', text: 'привіт', buttons: [] }),
      ).rejects.toThrow(/не налаштований/)
      await expect(
        unavailable.answerCallbackQuery({ callbackQueryId: 'q', text: 'ok' }),
      ).rejects.toThrow()
      await expect(
        unavailable.editMessageText({ chatId: '1', messageId: 1, text: 'ok' }),
      ).rejects.toThrow()
    })

    /**
     * Фейк не має писати в лог нічого з тіла: текст сповіщення — це чуже приватне
     * листування («Марта просить у вас «Шантарам»»), а `chat_id` — стабільний
     * ідентифікатор людини в Telegram.
     */
    it('фейковий транспорт не логує ні chat_id, ні текст, ні callback_data', async () => {
      const fake = app.get(FakeTelegramApi)
      const logged: string[] = []

      jest.spyOn(fake['logger'], 'log').mockImplementation((value: unknown) => {
        logged.push(String(value))
      })

      await fake.sendMessage({
        chatId: '987654321',
        text: 'Марта просить «Шантарам»',
        buttons: [{ text: 'Погодити', callbackData: 'loan:approve:clx123' }],
      })

      const output = logged.join('\n')

      expect(output).not.toContain('987654321')
      expect(output).not.toContain('Шантарам')
      expect(output).not.toContain('loan:approve:clx123')
      // Але сам факт відправки видно — інакше локально нічого не зрозуміло.
      expect(output).toContain('fake')

      jest.restoreAllMocks()
      fake.clear()
    })
  })

  describe('§7.3: доставок у неналаштований канал не буває', () => {
    /**
     * Головна перевірка файлу: `chat_id` міг лишитися від часів, коли бот був
     * налаштований (відновлення бекапу, перенесення бази). Це не привід
     * створювати доставку, яку нема кому виконати.
     */
    it('наявний chat_id без конфігурації не породжує TELEGRAM-доставки', async () => {
      const account = await registerAccount(app, 'unconfigured-chat')

      await prisma.user.update({
        where: { id: account.id },
        data: { telegramChatId: `restored-${account.id}`, emailVerified: true },
      })

      await notifications.create({
        userId: account.id,
        type: 'LOAN_REQUESTED',
        payload: { loanId: 'loan-unconfigured', copyId: 'copy-unconfigured' },
      })

      const notification = await prisma.notification.findFirstOrThrow({
        where: { userId: account.id },
        orderBy: { createdAt: 'desc' },
      })
      const channels = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
        select: { channel: true },
      })

      expect(channels.map((row) => row.channel).sort()).toEqual(['EMAIL', 'IN_APP'])

      // І жодного «успішно надіслано» в базі за цю подію — бо надсилати не було
      // куди. Перевірка навмисно скопована до конкретної події, а не глобальна:
      // e2e-файли ділять одну базу, і сусідні сценарії з увімкненим Telegram
      // (тестовим фейком, що вдає справжній бот) законно лишають TELEGRAM/SENT
      // рядки — вони належать до конфігурацій, де бот справді налаштований.
      await dispatcher.run()

      const afterDispatch = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      })

      expect(afterDispatch.some((row) => row.channel === 'TELEGRAM')).toBe(false)
    })
  })

  describe('§8: контракт і UI бачать «не налаштовано»', () => {
    /**
     * `configured` і `connected` — різні відповіді на «чому не працює».
     * Неналаштований бот не лікується кнопкою «Підключити», і UI має сказати про
     * сервер, а не пропонувати дію, яка нічого не змінить.
     */
    it('GET віддає configured: false окремо від connected', async () => {
      const account = await registerAccount(app, 'unconfigured-status')
      const response = await request(app.getHttpServer())
        .get(url('/me/notification-preferences'))
        .set('Cookie', account.cookie)
        .expect(200)

      const { channels } = notificationPreferencesResponseSchema.parse(response.body)

      expect(channels.telegram.configured).toBe(false)
      expect(channels.telegram.connected).toBe(false)
      expect(channels.telegram.available).toBe(false)
      // Решта каналів працює як звичайно — Telegram опційний (§7.2).
      expect(channels.inApp.available).toBe(true)
    })

    it('POST /me/telegram/link віддає 503 з машиночитним кодом', async () => {
      const account = await registerAccount(app, 'unconfigured-link')
      const response = await request(app.getHttpServer())
        .post(url('/me/telegram/link'))
        .set('Cookie', account.cookie)
        .expect(503)

      expect(codeOf(response.body)).toBe(API_ERROR_CODES.TELEGRAM_NOT_CONFIGURED)
    })

    /** Вебхук без налаштованого секрету не пускає нікого — а не пускає всіх. */
    it('вебхук відмовляє навіть без заголовка секрету', async () => {
      await request(app.getHttpServer())
        .post(url('/webhooks/telegram'))
        .send({ update_id: 1 })
        .expect(401)

      await request(app.getHttpServer())
        .post(url('/webhooks/telegram'))
        .set('X-Telegram-Bot-Api-Secret-Token', 'anything-at-all-0123456789')
        .send({ update_id: 1 })
        .expect(401)
    })

    it('увімкнути TELEGRAM у матриці не можна, поки бот не налаштований', async () => {
      const account = await registerAccount(app, 'unconfigured-prefs')

      await prisma.user.update({
        where: { id: account.id },
        data: { telegramChatId: `restored-prefs-${account.id}` },
      })

      const response = await request(app.getHttpServer())
        .put(url('/me/notification-preferences'))
        .set('Cookie', account.cookie)
        .send({ preferences: [{ type: 'LOAN_REQUESTED', channel: 'TELEGRAM', enabled: true }] })
        .expect(409)

      expect(codeOf(response.body)).toBe(API_ERROR_CODES.TELEGRAM_NOT_LINKED)
    })
  })
})
