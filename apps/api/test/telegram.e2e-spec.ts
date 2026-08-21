import 'reflect-metadata'
import request from 'supertest'
import { API_ERROR_CODES, apiErrorSchema, telegramLinkResponseSchema } from '@bookswap/shared'
import { createTestApp } from './auth.helpers'
import { gate, waitForBlockedBackend } from './concurrency.helpers'
import {
  befriend,
  createShelfCopy,
  registerAccount,
  requestLoan,
  url,
  type Account,
} from './loan.helpers'
import { FakeTelegramApi } from '../src/telegram/fake-telegram-api'
import { TELEGRAM_API } from '../src/telegram/telegram-api'
import { TelegramConfig } from '../src/telegram/telegram.config'
import { TELEGRAM_LINK_TTL_MS } from '../src/notifications/notifications.constants'
import { PrismaService } from '../src/prisma/prisma.service'
import { TEST_BOT_USERNAME, TEST_WEBHOOK_SECRET, configuredTelegram } from './telegram.helpers'
import { TelegramLinkService } from '../src/telegram/telegram-link.service'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

const BOT_USERNAME = TEST_BOT_USERNAME
const WEBHOOK_SECRET = TEST_WEBHOOK_SECRET

/**
 * §7.4: прив'язка Telegram, вебхук і інлайн-кнопки.
 *
 * Конфіг бота підмінений справжнім `TelegramConfig` поверх фейкового
 * `ConfigService`, а не заглушкою з `useValue: { matchesWebhookSecret: () => true }`:
 * §11 прямо вимагає «перевірку авторизації колбеку Telegram», і заглушка, що
 * завжди каже «так», перевіряла б рівно нічого. Транспорт при цьому фейковий —
 * жодного HTTP назовні.
 */
describe('Telegram (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let telegram: FakeTelegramApi

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(TelegramConfig).useValue(configuredTelegram())
        // Обов'язково разом із конфігом: інакше фабрика `TELEGRAM_API` побачила б
        // «бот налаштований» і підняла б справжній HTTP-транспорт.
        builder.overrideProvider(TELEGRAM_API).useClass(FakeTelegramApi)
      },
    })

    prisma = app.get(PrismaService)
    telegram = app.get<FakeTelegramApi>(TELEGRAM_API)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    telegram.clear()
  })

  const codeOf = (body: unknown): string => apiErrorSchema.parse(body).code

  /**
   * `null` означає «взагалі без заголовка».
   *
   * Не `undefined`: явно переданий `undefined` у JS вмикає значення параметра за
   * замовчуванням, тобто тест «без секрету» мовчки надсилав би правильний секрет
   * і проходив би завжди.
   */
  function webhook(update: object, secret: string | null = WEBHOOK_SECRET): request.Test {
    const test = request(app.getHttpServer()).post(url('/webhooks/telegram')).send(update)

    return secret === null ? test : test.set('X-Telegram-Bot-Api-Secret-Token', secret)
  }

  async function linkToken(account: Account): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(url('/me/telegram/link'))
      .set('Cookie', account.cookie)
      .expect(201)

    const { deepLink } = telegramLinkResponseSchema.parse(response.body)

    return new URL(deepLink).searchParams.get('start') ?? ''
  }

  /** Реєструє акаунт і доводить прив'язку до кінця — через бота, як робить людина. */
  async function linkedAccount(prefix: string, chatId: string): Promise<Account> {
    const account = await registerAccount(app, prefix)
    const token = await linkToken(account)

    await webhook(startUpdate(token, chatId)).expect(200)

    return account
  }

  function startUpdate(token: string, chatId: string): object {
    return {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: Number(chatId), type: 'private' },
        from: { id: Number(chatId), is_bot: false, first_name: 'Тест' },
        text: `/start ${token}`,
        // Поле, якого немає в нашій схемі: Telegram шле такі постійно.
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    }
  }

  /** `/start` із групи: `chat.id` — групи, `from.id` — людини, і вони різні. */
  function groupStartUpdate(token: string, chatId: string, type: string, fromId: string): object {
    return {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: Number(chatId), type, title: 'Книжковий клуб' },
        from: { id: Number(fromId), is_bot: false, first_name: 'Тест' },
        text: `/start ${token}`,
      },
    }
  }

  function callbackUpdate(data: string, chatId: string): object {
    return {
      update_id: 2,
      callback_query: {
        id: `cbq-${chatId}-${data}`,
        from: { id: Number(chatId), is_bot: false, first_name: 'Тест' },
        chat_instance: 'instance',
        data,
        message: {
          message_id: 55,
          chat: { id: Number(chatId), type: 'private' },
          text: 'Хтось просить книжку',
        },
      },
    }
  }

  let chatSequence = 700_000

  const nextChatId = (): string => String((chatSequence += 1))

  /**
   * Ламає найближчу інтерактивну транзакцію — після того, як її тіло відпрацювало.
   *
   * Підміняти окремі моделі (`prisma.user.update`) марно: усередині транзакції
   * запис іде через `tx`, тобто інший об'єкт. А от кинути в самому кінці callback'а
   * — це рівно те, що робить будь-який збій наприкінці: усе, що тіло встигло
   * записати, має відкотитися разом.
   */
  function breakNextTransaction(): jest.SpyInstance {
    const original = prisma.$transaction.bind(prisma) as (arg: unknown) => Promise<unknown>
    const broken = (arg: unknown): Promise<unknown> => {
      if (typeof arg !== 'function') return original(arg)

      return original(async (tx: unknown) => {
        await (arg as (tx: unknown) => Promise<unknown>)(tx)

        throw new Error('Симульований збій наприкінці транзакції')
      })
    }

    return jest.spyOn(prisma, '$transaction').mockImplementationOnce(broken)
  }

  /**
   * Один провал транзакції з формою помилки, знятою з РЕАЛЬНОГО Postgres
   * (не вигадана структура): дедлок 40P01 отриманий, буквально провокуючи
   * дві транзакції, що лочать ті самі два рядки у зворотному порядку;
   * P2002 на `User_telegramChatId_key` — буквально створюючи два `User` з
   * однаковим `telegramChatId`. Обидві форми зафіксовані в
   * `meta.driverAdapterError.cause`, як і читає `prisma-errors.ts`.
   *
   * Навіщо це, а не лише барʼєрні тести вище: справжній 40P01 вимагає, щоб
   * ОБИДВІ транзакції чекали одна на одну ЩОНАЙМЕНШЕ `deadlock_timeout`
   * PostgreSQL (типово 1с) — а саме тіло `attemptConsume()` виконується за
   * одиниці мілісекунд, тож природний виграш однієї сторони ДО того, як
   * друга взагалі дійде до конфліктного рядка, — цілком реалістичний і
   * законний результат гонки, а не відсутність тесту. Ці два тести
   * гарантовано, а не ймовірно, проганяють саме гілку ретраю.
   */
  function failTransactionsWith(
    shape: 'deadlock' | 'unique-chat-id',
    failures: number,
  ): jest.SpyInstance {
    const original = prisma.$transaction.bind(prisma) as (arg: unknown) => Promise<unknown>
    const driverCause =
      shape === 'deadlock'
        ? {
            originalCode: '40P01',
            originalMessage: 'deadlock detected',
            kind: 'postgres',
            code: '40P01',
            severity: 'ERROR',
            message: 'deadlock detected',
            detail:
              'Process 1 waits for ShareLock on transaction 2; blocked by process 2.\n' +
              'Process 2 waits for ShareLock on transaction 1; blocked by process 1.',
            hint: 'See server log for query details.',
          }
        : {
            originalCode: '23505',
            originalMessage:
              'duplicate key value violates unique constraint "User_telegramChatId_key"',
            kind: 'UniqueConstraintViolation',
            constraint: { fields: ['"telegramChatId"'] },
          }
    const injected = Object.assign(new Error(driverCause.originalMessage), {
      name: 'PrismaClientKnownRequestError',
      code: shape === 'deadlock' ? 'P2010' : 'P2002',
      meta: { driverAdapterError: { name: 'DriverAdapterError', cause: driverCause } },
    })

    let failed = 0

    return jest.spyOn(prisma, '$transaction').mockImplementation((arg: unknown) => {
      if (failed < failures) {
        failed += 1

        return Promise.reject(injected)
      }

      return original(arg)
    })
  }

  function failTransactionOnceWith(shape: 'deadlock' | 'unique-chat-id'): jest.SpyInstance {
    return failTransactionsWith(shape, 1)
  }

  describe('§8: POST /me/telegram/link', () => {
    it('віддає deep link виду t.me/<bot>?start=<token>', async () => {
      const account = await registerAccount(app, 'tg-link')
      const response = await request(app.getHttpServer())
        .post(url('/me/telegram/link'))
        .set('Cookie', account.cookie)
        .expect(201)

      const body = telegramLinkResponseSchema.parse(response.body)

      expect(body.deepLink).toContain(`t.me/${BOT_USERNAME}?start=`)

      const token = new URL(body.deepLink).searchParams.get('start') ?? ''

      // §7.4: криптографічно стійке значення, а не послідовний id.
      expect(token.length).toBeGreaterThanOrEqual(32)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)

      // TTL — 10 хвилин.
      const ttl = new Date(body.expiresAt).getTime() - Date.now()

      expect(ttl).toBeGreaterThan(TELEGRAM_LINK_TTL_MS - 60_000)
      expect(ttl).toBeLessThanOrEqual(TELEGRAM_LINK_TTL_MS)
    })

    it('без сесії не видається', async () => {
      await request(app.getHttpServer()).post(url('/me/telegram/link')).expect(401)
    })

    /**
     * Нове посилання гасить попереднє: кнопку могли натиснути тричі, і три живі
     * токени одночасно — це три способи прив'язати три різні чати.
     */
    it('нове посилання знецінює попереднє', async () => {
      const account = await registerAccount(app, 'tg-relink')
      const first = await linkToken(account)
      const second = await linkToken(account)

      expect(first).not.toBe(second)
      expect(await prisma.telegramLinkToken.findUnique({ where: { token: first } })).toBeNull()
    })

    /**
     * §5 дефекту: `deleteMany` і `create` йшли двома autocommit-запитами. Два
     * паралельні виклики (подвійний клік, дві вкладки) читали «старих токенів
     * немає» одночасно — жоден не бачив рядка іншого — і лишали по собі ДВА
     * чинні токени, хоча коментар над методом обіцяє «останній — єдиний
     * дійсний».
     *
     * Гейт ставиться на `deleteMany` — саме там, де транзакція вже тримає
     * `FOR UPDATE`-лок на `User`, але ще не встигла ні видалити старе, ні
     * створити нове. `waitForBlockedBackend` доводить, що другий виклик
     * СПРАВДІ заблокований на цьому локу, а не просто «не встиг».
     */
    it('два одночасні createLink() лишають рівно один чинний токен', async () => {
      const account = await registerAccount(app, 'tg-concurrent-link')
      const links = app.get(TelegramLinkService)

      // Лок тримає сам тест — не мокаючи внутрішні виклики `createLink()`
      // (transaction-scoped `tx.telegramLinkToken` — інший делегат, не той
      // самий об'єкт, що й `prisma.telegramLinkToken`, тож шпигувати на
      // ньому напряму марно). Натомість тест бере ТОЙ САМИЙ `FOR UPDATE`-лок
      // на `User`, яким користується сам метод, і тримає його, поки не
      // запустить обидва реальні виклики й не переконається, що вони справді
      // чекають на цей лок.
      const barrier = gate()
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const firstCall = links.createLink(account.id)
      const secondCall = links.createLink(account.id)

      await waitForBlockedBackend(prisma, { expectedCount: 2 })

      barrier.release.resolve()
      await holder

      const [firstLink, secondLink] = await Promise.all([firstCall, secondCall])

      const tokenOf = (link: { deepLink: string }): string =>
        new URL(link.deepLink).searchParams.get('start') ?? ''

      const firstToken = tokenOf(firstLink)
      const secondToken = tokenOf(secondLink)

      expect(firstToken).not.toBe(secondToken)

      // Інваріант, заради якого весь тест: рівно один чинний токен, хоч би як
      // упали в часі два виклики.
      const validTokens = await prisma.telegramLinkToken.findMany({
        where: { userId: account.id, usedAt: null, expiresAt: { gt: new Date() } },
      })

      expect(validTokens).toHaveLength(1)

      const survivor = validTokens[0]?.token
      const loser = survivor === firstToken ? secondToken : firstToken

      expect([firstToken, secondToken]).toContain(survivor)

      // І це не лише рядок у базі: переможений токен справді відхиляється як
      // недійсний, а той, що вижив, справді працює.
      const winnerChat = nextChatId()

      await webhook(startUpdate(survivor ?? '', winnerChat)).expect(200)
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(winnerChat)

      const loserChat = nextChatId()

      await webhook(startUpdate(loser, loserChat)).expect(200)
      expect(
        await prisma.user.count({ where: { id: account.id, telegramChatId: loserChat } }),
      ).toBe(0)
    }, 15_000)
  })

  describe('§7.4: вебхук і секрет', () => {
    /**
     * Bot API не підписує тіло вебхука — `secret_token` із `setWebhook`, повернутий
     * заголовком, це весь механізм автентифікації, який Telegram дає. Тому маршрут
     * без нього не має робити нічого: він змінює стан лоанів.
     */
    it('без заголовка секрету — 401', async () => {
      const response = await webhook({ update_id: 1 }, null).expect(401)

      expect(codeOf(response.body)).toBe(API_ERROR_CODES.UNAUTHORIZED)
    })

    it('з чужим секретом — 401', async () => {
      await webhook({ update_id: 1 }, 'not-the-secret-0123456789012').expect(401)
    })

    it('секрет із правильним префіксом, але іншої довжини — 401', async () => {
      await webhook({ update_id: 1 }, WEBHOOK_SECRET.slice(0, -1)).expect(401)
    })

    it('з правильним секретом — 200', async () => {
      await webhook({ update_id: 1 }).expect(200)
    })

    /**
     * Будь-яка відповідь, крім 200, змушує Telegram повторювати те саме
     * оновлення — і кожен повтор надсилав би людині ще одне повідомлення.
     */
    it('незрозуміле тіло не дає 4xx: інакше Telegram повторюватиме вічно', async () => {
      await webhook({ message: { чужа: 'форма' } }).expect(200)
      await webhook({}).expect(200)
    })
  })

  describe('§7.4: /start прив’язує chat_id', () => {
    it('зберігає chat_id, гасить токен і відповідає в чат', async () => {
      const account = await registerAccount(app, 'tg-start')
      const token = await linkToken(account)
      const chatId = nextChatId()

      await webhook(startUpdate(token, chatId)).expect(200)

      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id } })

      expect(user.telegramChatId).toBe(chatId)

      const row = await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })

      expect(row.usedAt).not.toBeNull()
      expect(telegram.lastTo(chatId)?.text).toContain('Готово')
    })

    /** §7.4: «token одноразовий». */
    it('той самий токен удруге не спрацьовує', async () => {
      const account = await registerAccount(app, 'tg-once')
      const token = await linkToken(account)
      const first = nextChatId()
      const second = nextChatId()

      await webhook(startUpdate(token, first)).expect(200)
      await webhook(startUpdate(token, second)).expect(200)

      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id } })

      // Прив'язка лишилася на першому чаті — другий її не перехопив.
      expect(user.telegramChatId).toBe(first)
      expect(telegram.lastTo(second)?.text).toContain('вже використали')
    })

    it('прострочений токен не спрацьовує', async () => {
      const account = await registerAccount(app, 'tg-expired')
      const token = await linkToken(account)
      const chatId = nextChatId()

      await prisma.telegramLinkToken.update({
        where: { token },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })

      await webhook(startUpdate(token, chatId)).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()
      expect(telegram.lastTo(chatId)?.text).toContain('протухло')
    })

    it('невідомий токен не спрацьовує', async () => {
      const chatId = nextChatId()

      await webhook(startUpdate('ceirf-nema-takoho-tokena', chatId)).expect(200)

      expect(telegram.lastTo(chatId)?.text).toContain('недійсне')
      expect(await prisma.user.count({ where: { telegramChatId: chatId } })).toBe(0)
    })

    it('голий /start підказує, що робити', async () => {
      const chatId = nextChatId()

      await webhook({
        message: { message_id: 1, chat: { id: Number(chatId) }, text: '/start' },
      }).expect(200)

      expect(telegram.lastTo(chatId)?.text).toContain('Підключити Telegram')
    })

    /** Один чат не може обслуговувати два акаунти: `User.telegramChatId` — `@unique`. */
    it('прив’язка того самого чату до іншого акаунта забирає його в попереднього', async () => {
      const chatId = nextChatId()
      const first = await linkedAccount('tg-move-first', chatId)
      const second = await registerAccount(app, 'tg-move-second')

      await webhook(startUpdate(await linkToken(second), chatId)).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).telegramChatId,
      ).toBeNull()
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).telegramChatId,
      ).toBe(chatId)
    })
  })

  describe('§7.2: прив’язка лише в приватному чаті', () => {
    /**
     * §7.2 прямо відкидає спільну групу як канал: «усі бачать, хто в кого що
     * просить (суперечить §6.6); немає адресації конкретній людині; немає способу
     * довести, що `@username` у групі — власник акаунта».
     *
     * Прив'язка акаунта до групи повернула б усі три проблеми й додала б
     * четверту: інлайн-кнопки «Погодити» під чужим запитом стали б доступні
     * кожному учаснику.
     */
    it.each(['group', 'supergroup', 'channel'])('у чаті типу %s не прив’язує', async (type) => {
      const account = await registerAccount(app, `tg-${type}`)
      const token = await linkToken(account)
      const groupChat = nextChatId()
      const person = nextChatId()

      await webhook(groupStartUpdate(token, groupChat, type, person)).expect(200)

      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id } })

      expect(user.telegramChatId).toBeNull()

      // Токен НЕ згорів: інакше єдиною відповіддю сервісу на випадковий клік у
      // групі було б «згенеруйте нове».
      const row = await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })

      expect(row.usedAt).toBeNull()

      // І він далі працює там, де має, — у приватному чаті.
      const privateChat = nextChatId()

      await webhook(startUpdate(token, privateChat)).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(privateChat)
    })

    /**
     * `chat.type === 'private'` замало: у приватному чаті Telegram `chat.id`
     * дорівнює `from.id`. Розбіжність означає сценарій, якого ми не розуміємо, —
     * і прив'язувати до нього акаунт не можна.
     */
    it('не прив’язує, коли from.id не збігається з приватним chat.id', async () => {
      const account = await registerAccount(app, 'tg-mismatch')
      const token = await linkToken(account)
      const chatId = nextChatId()

      await webhook({
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: Number(chatId), type: 'private' },
          from: { id: Number(nextChatId()), is_bot: false, first_name: 'Хтось інший' },
          text: `/start ${token}`,
        },
      }).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })).usedAt,
      ).toBeNull()
    })

    it('груповий чат не може підмінити наявну прив’язку', async () => {
      const chatId = nextChatId()
      const account = await linkedAccount('tg-group-hijack', chatId)
      const token = await linkToken(account)
      const groupChat = nextChatId()

      await webhook(groupStartUpdate(token, groupChat, 'supergroup', chatId)).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(chatId)
    })
  })

  describe('§7.4: атомарність прив’язки й відв’язки', () => {
    /**
     * `usedAt` і `telegramChatId` — половини одного рішення. Якщо перша
     * комітиться окремо, збій на другій лишає найгірший з можливих станів: токен
     * уже «використаний», чат не прив'язаний, і виходу з цього в людини немає.
     */
    it('збій під час прив’язки не гасить токен', async () => {
      const account = await registerAccount(app, 'tg-link-rollback')
      const token = await linkToken(account)
      const chatId = nextChatId()

      const spy = breakNextTransaction()

      try {
        await webhook(startUpdate(token, chatId)).expect(200)
      } finally {
        spy.mockRestore()
      }

      const row = await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })

      expect(row.usedAt).toBeNull()
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()

      // І та сама спроба проходить нормально — стан не «залип».
      await webhook(startUpdate(token, chatId)).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(chatId)
    })

    /**
     * Дзеркальна половина: якщо зняття `chat_id` закомітилося, а знецінення
     * токенів — ні, посилання, згенероване за хвилину до відв'язки, лишиться
     * робочим і мовчки поверне все назад.
     */
    it('збій під час відв’язки лишає прив’язку цілою', async () => {
      const chatId = nextChatId()
      const account = await linkedAccount('tg-unlink-rollback', chatId)

      const spy = breakNextTransaction()

      try {
        await request(app.getHttpServer())
          .delete(url('/me/telegram'))
          .set('Cookie', account.cookie)
          .expect(500)
      } finally {
        spy.mockRestore()
      }

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(chatId)

      // Повторна спроба доводить справу до кінця.
      await request(app.getHttpServer())
        .delete(url('/me/telegram'))
        .set('Cookie', account.cookie)
        .expect(204)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()
    })

    it('відв’язка знецінює невикористані посилання', async () => {
      const chatId = nextChatId()
      const account = await linkedAccount('tg-unlink-tokens', chatId)
      const token = await linkToken(account)

      await request(app.getHttpServer())
        .delete(url('/me/telegram'))
        .set('Cookie', account.cookie)
        .expect(204)

      expect(await prisma.telegramLinkToken.findUnique({ where: { token } })).toBeNull()

      // Посилання, згенероване до відв'язки, більше нічого не повертає.
      await webhook(startUpdate(token, chatId)).expect(200)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()
    })
  })

  describe('§5 дефекту: єдиний порядок локів User → TelegramLinkToken', () => {
    /**
     * Раніше `consume()` спершу клеймив рядок токена (`updateMany` по
     * `token`) і лише потім торкався `User` — у зворотному порядку відносно
     * `createLink()`/`unlink()`, які спершу лочать `User`. Два паралельні
     * виклики на того самого користувача — `createLink()` (нове посилання з
     * профілю) і `consume()` старого токена (`/start` з посилання, надісланого
     * хвилину тому) — могли зациклитися: `createLink()` тримає лок на `User` і
     * чекає на рядок токена, який щойно захопив `consume()`, а той — навпаки,
     * чекає на `User`. PostgreSQL ловить це сам (40P01) і рве одну з двох
     * транзакцій: клієнт, що зробив усе правильно (один клік, послідовні дії),
     * міг отримати 500 через чужий паралельний запит.
     *
     * Тест женить обидва РЕАЛЬНІ виклики одночасно проти спільного локу, який
     * тримає сам тест (той самий `SELECT … FOR UPDATE` на `User`, яким
     * користуються самі методи) — `waitForBlockedBackend` доводить, що обидва
     * справді чекають на цей лок, а не проскакують повз нього. Хто саме з
     * двох Postgres пустить уперед — не наша справа: важливо, що жоден не
     * падає, і що фінальний стан самоузгоджений із тим, хто саме виграв.
     */
    it('createLink() і consume() старого токена не зациклюються один на одному', async () => {
      const account = await registerAccount(app, 'tg-lock-order-link-consume')
      const links = app.get(TelegramLinkService)
      const oldToken = await linkToken(account)
      const chatId = nextChatId()

      const barrier = gate()
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const consuming = links.consume(oldToken, chatId)
      const linking = links.createLink(account.id)

      await waitForBlockedBackend(prisma, { expectedCount: 2 })

      barrier.release.resolve()
      await holder

      // Головна перевірка: жоден реальний виклик не впав — ні 40P01, ні
      // будь-яка інша несподіванка. `Promise.all` сам відхилиться, якщо
      // хтось із двох кинув.
      const [consumeResult, linkResult] = await Promise.all([consuming, linking])

      // Незалежно від того, хто встиг першим: `createLink()` завжди спершу
      // гасить усе невикористане й лише потім створює нове, тож після нього
      // лишається рівно один чинний токен — і це саме той, який він
      // повернув.
      const validTokens = await prisma.telegramLinkToken.findMany({
        where: { userId: account.id, usedAt: null, expiresAt: { gt: new Date() } },
      })

      expect(validTokens).toHaveLength(1)

      const newToken = new URL(linkResult.deepLink).searchParams.get('start') ?? ''

      expect(validTokens[0]?.token).toBe(newToken)

      // Токен не використовується двічі: щонайбільше один рядок цього
      // користувача коли-небудь був позначений використаним.
      const usedTokens = await prisma.telegramLinkToken.count({
        where: { userId: account.id, usedAt: { not: null } },
      })

      expect(usedTokens).toBeLessThanOrEqual(1)

      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id } })

      if (consumeResult.ok) {
        // consume() устиг першим: старий токен спрацював, chat_id записано.
        expect(user.telegramChatId).toBe(chatId)
        expect(usedTokens).toBe(1)
      } else {
        // createLink() устиг першим і видалив старий токен ще
        // невикористаним: consume() чесно повідомляє «токена нема», а не
        // падає й не зависає в очікуванні лока, який ніколи не звільниться.
        expect(consumeResult.reason).toBe('UNKNOWN_TOKEN')
        expect(user.telegramChatId).toBeNull()
        expect(usedTokens).toBe(0)
      }
    }, 15_000)

    /**
     * Та сама пара, дзеркально: `unlink()` теж лочить `User` першим (сам
     * `updateMany`, яким він знімає `chat_id`, і є цим локом), а `consume()` —
     * тепер так само. Раніше `consume()` міг зациклитися на цій парі так само,
     * як на `createLink()`.
     *
     * Сценарій: людина вже підключена (`firstChat`), тисне «Підключити» ще
     * раз (нова кнопка в профілі про всяк випадок) і водночас натискає
     * «Відключити» в іншій вкладці — і саме тоді хтось встигає натиснути
     * Start у боті зі свіжим посиланням.
     */
    it('unlink() і consume() нового токена не зациклюються один на одному', async () => {
      const firstChat = nextChatId()
      const account = await linkedAccount('tg-lock-order-unlink-consume', firstChat)
      const links = app.get(TelegramLinkService)
      const newToken = await linkToken(account)
      const secondChat = nextChatId()

      const barrier = gate()
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const consuming = links.consume(newToken, secondChat)
      const unlinking = links.unlink(account.id)

      await waitForBlockedBackend(prisma, { expectedCount: 2 })

      barrier.release.resolve()
      await holder

      // Ні 40P01, ні жодна інша несподіванка — `Promise.all` відхилився б,
      // якби хтось із двох кинув.
      const [consumeResult] = await Promise.all([consuming, unlinking])

      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id } })

      // В обох порядках `unlink()` зрештою знімає `chat_id`: якщо він
      // устиг першим — знімає одразу (був `firstChat`); якщо другим —
      // застає вже `secondChat` (`consume()` встиг переписати) і знімає
      // його. Кінцевий стан один і той самий незалежно від порядку.
      expect(user.telegramChatId).toBeNull()

      // "Не використовується двічі" перевіряється саме на `newToken`, а не
      // лічильником усіх used-рядків користувача: той, яким `linkedAccount()`
      // прив'язав `firstChat` на самому початку, назавжди лишається в базі
      // використаним (`unlink()` видаляє лише НЕвикористані токени) — і це
      // окрема, вже закомічена подія, а не частина цієї гонки.
      const newTokenRow = await prisma.telegramLinkToken.findUnique({ where: { token: newToken } })

      if (consumeResult.ok) {
        // consume() устиг першим: новий токен спрацював і лишився в базі
        // позначеним використаним рівно один раз (unlink() видаляє лише
        // невикористані).
        expect(newTokenRow?.usedAt).not.toBeNull()
      } else {
        // unlink() устиг першим і видалив токен ще невикористаним:
        // consume() чесно повідомляє «токена нема», ніде не позначаючи
        // його використаним.
        expect(consumeResult.reason).toBe('UNKNOWN_TOKEN')
        expect(newTokenRow).toBeNull()
      }
    }, 15_000)
  })

  describe('§5 дефекту: PostgreSQL clock після очікування лока', () => {
    /**
     * Blocker: `now()`/`CURRENT_TIMESTAMP` у PostgreSQL — це час ПОЧАТКУ
     * транзакції, а не момент виконання конкретного запиту. Обидва методи
     * читають час ПІСЛЯ `SELECT … FOR UPDATE`, який щойно міг простояти в
     * черзі за локом, — і якби це був `now()`, він однаково показав би час
     * ДО очікування.
     *
     * Тест ставить `expiresAt` токена так, щоб він був чинним у момент
     * ВИКЛИКУ `consume()`, але протух саме за час очікування на лок
     * (тримає його тест, як і в барʼєрних тестах вище). Стара помилка
     * (`now()`) прийняла б токен як чинний — його `expiresAt` порівнювався б
     * із часом ДО очікування, коли він іще не протух. Правильна поведінка
     * (`clock_timestamp()`) бачить справжній поточний час і відхиляє токен.
     */
    it('consume() відхиляє токен, що протух САМЕ під час очікування на лок', async () => {
      const account = await registerAccount(app, 'clock-consume-expired')
      const links = app.get(TelegramLinkService)
      const token = await linkToken(account)
      const chatId = nextChatId()

      // Малий TTL — навмисно набагато коротший за реальний (10 хв), щоб
      // реальний час устиг перетнути його під час очікування на барʼєр.
      const shortExpiresAt = new Date(Date.now() + 400)

      await prisma.telegramLinkToken.update({
        where: { token },
        data: { expiresAt: shortExpiresAt },
      })

      const barrier = gate()
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const consuming = links.consume(token, chatId)

      await waitForBlockedBackend(prisma)

      // Чекаємо, доки реальний час СПРАВДІ мине expiresAt, перш ніж
      // відпустити лок — не довільний sleep «про всяк випадок», а
      // очікування конкретної, наперед відомої умови, без якої тест
      // нічого не доводить.
      while (Date.now() <= shortExpiresAt.getTime()) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      barrier.release.resolve()
      await holder

      const result = await consuming

      expect(result).toEqual({ ok: false, reason: 'EXPIRED' })

      const row = await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })

      expect(row.usedAt).toBeNull()
      expect(await prisma.user.count({ where: { id: account.id, telegramChatId: chatId } })).toBe(0)
    }, 15_000)

    /**
     * `createLink()` мусить видати TTL, порахований від моменту, коли
     * транзакція СПРАВДІ дістала лок і почала діяти, а не від моменту
     * виклику. Тест тримає лок реальний час (>1с) — з `now()` TTL був би
     * коротшим саме на цю затримку; з `clock_timestamp()` він рахується
     * заново, вже під локом, і виходить повним.
     */
    it('createLink() після очікування на лок усе одно дає повний TTL', async () => {
      const account = await registerAccount(app, 'clock-create-ttl')
      const links = app.get(TelegramLinkService)

      const barrier = gate()
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const linking = links.createLink(account.id)

      await waitForBlockedBackend(prisma)

      // Реальна затримка — і це саме те, що тест перевіряє: чи переживає
      // TTL цю затримку, а не спосіб дочекатися чогось іншого.
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const beforeRelease = Date.now()

      barrier.release.resolve()
      await holder

      const link = await linking
      const ttlMs = new Date(link.expiresAt).getTime() - beforeRelease

      // Стара помилка (`now()`) дала б тут TTL коротший приблизно на 1.5с
      // (тривалість утримання лока) — вузький допуск (500 мс замість, як у
      // сценарії вище, довільного) якраз і відрізняє «повний TTL, порахований
      // після очікування» від «TTL, порахований до нього і скорочений».
      expect(ttlMs).toBeGreaterThan(TELEGRAM_LINK_TTL_MS - 500)
      expect(ttlMs).toBeLessThanOrEqual(TELEGRAM_LINK_TTL_MS + 500)
    }, 15_000)
  })

  describe('§5 дефекту: глобальна конкурентність consume() між двома користувачами', () => {
    /**
     * Порядок локів `User → TelegramLinkToken` безпечний лише для ОДНОГО
     * user. Тут — двоє: `X` забирає чат, яким щойно володіє `Y`, а `Y` —
     * той, яким володіє `X`, майже одночасно. Кожна транзакція лочить
     * СВОГО власника токена першою (як і мала б), а тоді намагається
     * змінити рядок ІНШОГО користувача (той, хто зараз тримає `chatId`) —
     * і якщо той інший якраз симетрично чекає на цю саму транзакцію,
     * PostgreSQL ловить цикл (40P01).
     *
     * Барʼєр тут тримає ОБИДВА лока одночасно (а не один, як у тестах
     * вище) і відпускає їх «спина до спини» — це найближче до гарантії
     * справжнього перехрестя, яку можна влаштувати, не міняючи виробничий
     * код: обидва `consume()` стартують з однієї лінії старту.
     *
     * Але сам тест не вимагає, щоб дедлок СТАВСЯ: `consume()` тепер
     * повторює спробу на 40P01/P2002 (`MAX_CONSUME_ATTEMPTS`), тож
     * правильний результат — той самий чистий обмін — вірний незалежно від
     * того, впіймав Postgres цикл чи ні. Перевіряється те, що тримається
     * ЗА БУДЬ-ЯКОЇ послідовності виконання: жодного необробленого винятку,
     * і фінальний стан — справжній обмін, а не втрата чи дублювання.
     */
    it('X і Y одночасно забирають чат один одного — обмін без 5xx/deadlock, що просочився назовні', async () => {
      const chatX = nextChatId()
      const chatY = nextChatId()
      const userX = await linkedAccount('swap-x', chatX)
      const userY = await linkedAccount('swap-y', chatY)
      const links = app.get(TelegramLinkService)

      const tokenXtoY = await linkToken(userX)
      const tokenYtoX = await linkToken(userY)

      const barrierX = gate()
      const holderX = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userX.id} FOR UPDATE`
        barrierX.entered.resolve()
        await barrierX.release.promise
      })

      await barrierX.entered.promise

      const barrierY = gate()
      const holderY = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userY.id} FOR UPDATE`
        barrierY.entered.resolve()
        await barrierY.release.promise
      })

      await barrierY.entered.promise

      const consumingX = links.consume(tokenXtoY, chatY)
      const consumingY = links.consume(tokenYtoX, chatX)

      // Доводимо, що ОБИДВА реальні виклики справді чекають на лок, який
      // тримає тест, — не просто «ще не встигли».
      await waitForBlockedBackend(prisma, { expectedCount: 2 })

      // «Спина до спини» — без await між ними: обидва лока звільняються в
      // одному синхронному проході, максимально близько до одночасного.
      barrierX.release.resolve()
      barrierY.release.resolve()
      await Promise.all([holderX, holderY])

      // Ні 40P01, ні P2002 не мають дійти до виклику як необроблений
      // виняток — Promise.all відхилився б, якби хтось із двох кинув.
      const [resultX, resultY] = await Promise.all([consumingX, consumingY])

      expect(resultX.ok).toBe(true)
      expect(resultY.ok).toBe(true)

      // Обмін відбувся чисто: X тепер на chatY, Y — на chatX. Не двоє на
      // одному чаті, не «загублений» третій стан.
      const [finalX, finalY] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userX.id } }),
        prisma.user.findUniqueOrThrow({ where: { id: userY.id } }),
      ])

      expect(finalX.telegramChatId).toBe(chatY)
      expect(finalY.telegramChatId).toBe(chatX)

      // unique User.telegramChatId — і структурно (обидва значення різні),
      // і на рівні бази (жоден третій рядок цей chatId не підхопив).
      expect(await prisma.user.count({ where: { telegramChatId: chatX } })).toBe(1)
      expect(await prisma.user.count({ where: { telegramChatId: chatY } })).toBe(1)

      // Обидва нові токени використані — жоден consume() не «мовчки програв»
      // без сліду.
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token: tokenXtoY } })).usedAt,
      ).not.toBeNull()
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token: tokenYtoX } })).usedAt,
      ).not.toBeNull()
    }, 15_000)

    /**
     * Друга гонка: двоє РІЗНИХ, ще не прив'язаних акаунтів одночасно тиснуть
     * Start у ТОМУ САМОМУ чаті (два токени на один `chat_id`) — не цикл
     * очікування, а конфлікт унікального індексу `User_telegramChatId_key`
     * у момент запису (P2002), бо жоден із двох `updateMany` (гасіння
     * попереднього власника) ще не бачить чужого незакомiченого запису.
     *
     * Як і вище, тест не вимагає САМЕ P2002: `consume()` повторює спробу,
     * тож коректний результат — «останній записаний — єдиний власник» —
     * вірний і тоді, коли Postgres упіймав конфлікт, і тоді, коли записи
     * лягли послідовно без нього.
     */
    it('два різні токени одночасно приземляються на той самий chatId — рівно один власник', async () => {
      const sharedChat = nextChatId()
      const userA = await registerAccount(app, 'same-chat-a')
      const userB = await registerAccount(app, 'same-chat-b')
      const links = app.get(TelegramLinkService)

      const tokenA = await linkToken(userA)
      const tokenB = await linkToken(userB)

      const barrierA = gate()
      const holderA = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userA.id} FOR UPDATE`
        barrierA.entered.resolve()
        await barrierA.release.promise
      })

      await barrierA.entered.promise

      const barrierB = gate()
      const holderB = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userB.id} FOR UPDATE`
        barrierB.entered.resolve()
        await barrierB.release.promise
      })

      await barrierB.entered.promise

      const consumingA = links.consume(tokenA, sharedChat)
      const consumingB = links.consume(tokenB, sharedChat)

      await waitForBlockedBackend(prisma, { expectedCount: 2 })

      barrierA.release.resolve()
      barrierB.release.resolve()
      await Promise.all([holderA, holderB])

      // Ні 40P01, ні P2002 не мають дійти сюди як необроблений виняток.
      const [resultA, resultB] = await Promise.all([consumingA, consumingB])

      expect(resultA.ok).toBe(true)
      expect(resultB.ok).toBe(true)

      // Рівно один власник sharedChat — unique-обмеження не порушено, і
      // «останній» (у фактичному порядку виконання Postgres) виграв.
      const holders = await prisma.user.findMany({ where: { telegramChatId: sharedChat } })

      expect(holders).toHaveLength(1)

      // Обидва токени погашені: програвший не лишається зі своїм акаунтом
      // «наче нічого не сталося» — його спроба теж дійшла до кінця, просто
      // без sharedChat на фінішній прямій.
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token: tokenA } })).usedAt,
      ).not.toBeNull()
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token: tokenB } })).usedAt,
      ).not.toBeNull()
    }, 15_000)

    /**
     * Детерміноване (не барʼєрне) доведення самої гілки ретраю: перша
     * спроба `consume()` падає з ФОРМОЮ дедлоку, знятою з реального
     * PostgreSQL (див. `failTransactionOnceWith`), друга — проходить
     * нормально. Барʼєрні тести вище доводять безпеку під РЕАЛЬНИМ
     * навантаженням; цей — що сама гілка `catch` → ретрай → успіх
     * узагалі працює, незалежно від того, чи барʼєрний тест того разу
     * влучив у вікно гонки.
     */
    it('consume() повторює спробу після одноразового дедлоку й завершується успіхом', async () => {
      const account = await registerAccount(app, 'retry-after-deadlock')
      const links = app.get(TelegramLinkService)
      const token = await linkToken(account)
      const chatId = nextChatId()

      const spy = failTransactionOnceWith('deadlock')

      try {
        const result = await links.consume(token, chatId)

        expect(result).toEqual({ ok: true, userId: account.id })
      } finally {
        spy.mockRestore()
      }

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(chatId)
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })).usedAt,
      ).not.toBeNull()
    })

    /** Те саме, для другої форми — P2002 на `User_telegramChatId_key`. */
    it('consume() повторює спробу після одноразового P2002 на chatId і завершується успіхом', async () => {
      const account = await registerAccount(app, 'retry-after-p2002')
      const links = app.get(TelegramLinkService)
      const token = await linkToken(account)
      const chatId = nextChatId()

      const spy = failTransactionOnceWith('unique-chat-id')

      try {
        const result = await links.consume(token, chatId)

        expect(result).toEqual({ ok: true, userId: account.id })
      } finally {
        spy.mockRestore()
      }

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBe(chatId)
    })

    /**
     * Межа bounded retry — теж частина контракту: після трьох поспіль 40P01
     * сервіс повертає доменний `CONFLICT`, вебхук лишається 200 (щоб Telegram не
     * ретраїв те саме оновлення), а людина отримує явне «спробуйте ще раз».
     */
    it('після трьох retry повертає доменний CONFLICT без погашення токена', async () => {
      const account = await registerAccount(app, 'retry-exhausted-conflict')
      const token = await linkToken(account)
      const chatId = nextChatId()
      const links = app.get(TelegramLinkService)
      const consumeSpy = jest.spyOn(links, 'consume')
      const spy = failTransactionsWith('deadlock', 3)
      let attempts = 0
      let result: unknown

      try {
        await webhook(startUpdate(token, chatId)).expect(200)
        attempts = spy.mock.calls.length
        result = await (consumeSpy.mock.results[0]?.value as Promise<unknown>)
      } finally {
        spy.mockRestore()
        consumeSpy.mockRestore()
      }

      expect(attempts).toBe(3)
      expect(result).toEqual({ ok: false, reason: 'CONFLICT' })
      expect(telegram.lastTo(chatId)?.text).toContain('Спробуйте ще раз')
      expect(
        (await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })).usedAt,
      ).toBeNull()
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()
    })

    /**
     * Ретраї не безмежні: неретраєбельна помилка (не 40P01/P2002 на
     * `telegramChatId`) мусить пройти крізь `consume()` незміненою й одразу
     * — жодного зайвого повтору, жодного `CONFLICT`, що ховав би справжню
     * причину.
     */
    it('нерозпізнана помилка транзакції не ретраїться і летить далі', async () => {
      const account = await registerAccount(app, 'no-retry-on-other-error')
      const links = app.get(TelegramLinkService)
      const token = await linkToken(account)
      const chatId = nextChatId()

      const spy = breakNextTransaction()

      try {
        await expect(links.consume(token, chatId)).rejects.toThrow(
          'Симульований збій наприкінці транзакції',
        )
      } finally {
        spy.mockRestore()
      }

      // Жодного побічного стану: транзакція впала до коміту.
      const row = await prisma.telegramLinkToken.findUniqueOrThrow({ where: { token } })

      expect(row.usedAt).toBeNull()
    })
  })

  describe('§7.4: інлайн-кнопки', () => {
    interface Scene {
      owner: Account
      borrower: Account
      ownerChat: string
      loanId: string
      copyId: string
    }

    async function scene(prefix: string): Promise<Scene> {
      const ownerChat = nextChatId()
      const owner = await linkedAccount(`${prefix}-owner`, ownerChat)
      const borrower = await registerAccount(app, `${prefix}-borrower`)

      await befriend(app, owner, borrower)

      const shelf = await createShelfCopy(app, owner)
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)

      return {
        owner,
        borrower,
        ownerChat,
        loanId: (created.body as { loan: { id: string } }).loan.id,
        copyId: shelf.copyId,
      }
    }

    /**
     * §7.4: «Дія з кнопки проходить через **той самий** сервісний метод, що й дія
     * з вебу».
     *
     * Доказ — не сам факт `APPROVED`, а повний набір побічних ефектів рядка §5.1
     * «REQUESTED → APPROVED»: `Copy.status = RESERVED`, конкуренти відхилені,
     * сповіщення розіслані. Паралельна реалізація в обробнику бота відтворила б
     * хіба що перше.
     */
    it('колбек власника виконує перехід через LoanService з усіма ефектами', async () => {
      const { owner, borrower, ownerChat, loanId, copyId } = await scene('tg-approve')

      // Конкурент: §5.1 вимагає авто-відхилення всіх інших REQUESTED.
      const rival = await registerAccount(app, 'tg-approve-rival')
      await befriend(app, owner, rival)
      const rivalCreated = await requestLoan(app, rival, copyId).expect(201)
      const rivalLoanId = (rivalCreated.body as { loan: { id: string } }).loan.id

      await webhook(callbackUpdate(`loan:approve:${loanId}`, ownerChat)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'APPROVED',
      )
      expect((await prisma.copy.findUniqueOrThrow({ where: { id: copyId } })).status).toBe(
        'RESERVED',
      )
      expect((await prisma.loan.findUniqueOrThrow({ where: { id: rivalLoanId } })).status).toBe(
        'REJECTED',
      )
      expect(
        await prisma.notification.count({
          where: { userId: borrower.id, type: 'LOAN_APPROVED' },
        }),
      ).toBe(1)

      // Кнопки прибираються: інакше повторне натискання дало б помилку переходу.
      expect(telegram.edited.at(-1)?.text).toContain('Погоджено')
    })

    /**
     * §7.4 і §11: обов'язковий негативний тест. Група — не приватний чат 1:1,
     * і `chat.type !== 'private'` мусить відхиляти дію ще ДО пошуку власника —
     * незалежно від того, чий `from.id` стоїть у колбеку.
     */
    it('колбек із групового чату відхиляється, LoanService не викликається', async () => {
      const { ownerChat, loanId } = await scene('tg-group-cb')
      const groupChatId = nextChatId()

      const groupCallback = {
        update_id: 3,
        callback_query: {
          id: `cbq-group-${loanId}`,
          from: { id: Number(ownerChat), is_bot: false, first_name: 'Тест' },
          chat_instance: 'instance',
          data: `loan:approve:${loanId}`,
          message: {
            message_id: 56,
            chat: { id: Number(groupChatId), type: 'supergroup' },
            text: 'Хтось просить книжку',
          },
        },
      }

      await webhook(groupCallback).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
      expect(telegram.answered.at(-1)?.text).toContain('приватному чаті')
    })

    /**
     * `from.id` — не довірений `chat_id`: у приватному чаті вони збігаються за
     * конструкцією Telegram, але сама наявність поля `from.id` цього не
     * доводить. Якщо `message.chat.id` розходиться з `callback.from.id`,
     * довіряти джерелу не можна взагалі.
     */
    it('колбек із розбіжністю chat.id і from.id відхиляється', async () => {
      const { ownerChat, loanId } = await scene('tg-mismatch-cb')
      const strangerId = nextChatId()

      const mismatched = {
        update_id: 4,
        callback_query: {
          id: `cbq-mismatch-${loanId}`,
          from: { id: Number(strangerId), is_bot: false, first_name: 'Тест' },
          chat_instance: 'instance',
          data: `loan:approve:${loanId}`,
          message: {
            message_id: 57,
            chat: { id: Number(ownerChat), type: 'private' },
            text: 'Хтось просить книжку',
          },
        },
      }

      await webhook(mismatched).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
      expect(telegram.answered.at(-1)?.text).toContain('приватному чаті')
    })

    /** Inline-колбек (`message` відсутній) не має чим довести приватний чат узагалі. */
    it('колбек без message (inline-режим) відхиляється', async () => {
      const { loanId, ownerChat } = await scene('tg-inline-cb')

      const inlineCallback = {
        update_id: 5,
        callback_query: {
          id: `cbq-inline-${loanId}`,
          from: { id: Number(ownerChat), is_bot: false, first_name: 'Тест' },
          chat_instance: 'instance',
          data: `loan:approve:${loanId}`,
          inline_message_id: 'inline-1',
        },
      }

      await webhook(inlineCallback).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
      expect(telegram.answered.at(-1)?.text).toContain('inline')
    })

    it('колбек reject відхиляє запит', async () => {
      const { ownerChat, loanId, copyId } = await scene('tg-reject')

      await webhook(callbackUpdate(`loan:reject:${loanId}`, ownerChat)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REJECTED',
      )
      // §5.1: відхилення примірника не чіпає.
      expect((await prisma.copy.findUniqueOrThrow({ where: { id: copyId } })).status).toBe(
        'AVAILABLE',
      )
    })

    /**
     * §11 називає цей тест обов'язковим, і ось чому: `callback_data` приходить від
     * клієнта. Якби обробник довіряв їй, будь-хто з прив'язаним чатом, угадавши
     * `loanId`, апрувив би чужі запити.
     */
    it('колбек із чужого chat_id відхиляється', async () => {
      const { loanId, copyId } = await scene('tg-foreign')
      const strangerChat = nextChatId()

      await linkedAccount('tg-foreign-stranger', strangerChat)

      await webhook(callbackUpdate(`loan:approve:${loanId}`, strangerChat)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
      expect((await prisma.copy.findUniqueOrThrow({ where: { id: copyId } })).status).toBe(
        'AVAILABLE',
      )
      // Однакова відповідь на «чуже» й «не існує»: кнопка не має ставати способом
      // перевіряти, які loanId є в базі.
      expect(telegram.answered.at(-1)?.text).toContain('не ваш або не існує')
    })

    /** Позичальник — теж сторона лоану, але примірник не його. */
    it('колбек позичальника на власному лоані відхиляється', async () => {
      const { borrower, loanId } = await scene('tg-borrower')
      const borrowerChat = nextChatId()
      const token = await linkToken(borrower)

      await webhook(startUpdate(token, borrowerChat)).expect(200)
      await webhook(callbackUpdate(`loan:approve:${loanId}`, borrowerChat)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
    })

    it('колбек із неприв’язаного чату відхиляється', async () => {
      const { loanId } = await scene('tg-unlinked')
      const chatId = nextChatId()

      await webhook(callbackUpdate(`loan:approve:${loanId}`, chatId)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
      expect(telegram.answered.at(-1)?.text).toContain('не прив’язаний')
    })

    it.each(['loan:approve:', 'loan:hand_over:cl123', 'сміття', 'loan:approve:cl 123'])(
      'зіпсована callback_data «%s» нічого не робить',
      async (data) => {
        const chatId = nextChatId()

        await linkedAccount(`tg-garbage-${String(chatSequence)}`, chatId)
        await webhook(callbackUpdate(data, chatId)).expect(200)

        expect(telegram.answered.at(-1)?.text).toBeDefined()
      },
    )

    it('колбек на неіснуючий лоан відхиляється так само, як на чужий', async () => {
      const chatId = nextChatId()

      await linkedAccount('tg-missing', chatId)
      await webhook(callbackUpdate('loan:approve:cmsxnemaietakoholoanu', chatId)).expect(200)

      expect(telegram.answered.at(-1)?.text).toContain('не ваш або не існує')
    })

    /** Повторне натискання проходить крізь стейт-машину й отримує її відмову. */
    it('повторний колбек не ламає стан', async () => {
      const { ownerChat, loanId } = await scene('tg-twice')

      await webhook(callbackUpdate(`loan:approve:${loanId}`, ownerChat)).expect(200)
      await webhook(callbackUpdate(`loan:approve:${loanId}`, ownerChat)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'APPROVED',
      )
    })
  })

  describe('§8: DELETE /me/telegram', () => {
    it('відв’язує чат', async () => {
      const chatId = nextChatId()
      const account = await linkedAccount('tg-unlink', chatId)

      await request(app.getHttpServer())
        .delete(url('/me/telegram'))
        .set('Cookie', account.cookie)
        .expect(204)

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).telegramChatId,
      ).toBeNull()
    })

    it('повторна відв’язка — 409 з машиночитним кодом', async () => {
      const account = await registerAccount(app, 'tg-unlink-twice')
      const response = await request(app.getHttpServer())
        .delete(url('/me/telegram'))
        .set('Cookie', account.cookie)
        .expect(409)

      expect(codeOf(response.body)).toBe(API_ERROR_CODES.TELEGRAM_NOT_LINKED)
    })

    it('після відв’язки колбек із того чату більше не працює', async () => {
      const chatId = nextChatId()
      const owner = await linkedAccount('tg-unlink-cb', chatId)
      const borrower = await registerAccount(app, 'tg-unlink-cb-borrower')

      await befriend(app, owner, borrower)

      const shelf = await createShelfCopy(app, owner)
      const created = await requestLoan(app, borrower, shelf.copyId).expect(201)
      const loanId = (created.body as { loan: { id: string } }).loan.id

      await request(app.getHttpServer())
        .delete(url('/me/telegram'))
        .set('Cookie', owner.cookie)
        .expect(204)

      await webhook(callbackUpdate(`loan:approve:${loanId}`, chatId)).expect(200)

      expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).status).toBe(
        'REQUESTED',
      )
    })
  })
})
