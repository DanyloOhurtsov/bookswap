import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import { API_ERROR_CODES, type TelegramLinkResponse } from '@bookswap/shared'
import { generateToken } from '../auth/tokens'
import { ApiException } from '../common/api.exception'
import { isDeadlockOrSerializationFailure, isUniqueViolationOn } from '../common/prisma-errors'
import { TELEGRAM_LINK_TTL_MS } from '../notifications/notifications.constants'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramConfig } from './telegram.config'

/** Чому прив'язка не відбулася. Обробник вебхука перетворює це на текст для людини. */
export type LinkFailure = 'UNKNOWN_TOKEN' | 'EXPIRED' | 'USED' | 'CONFLICT'

export type LinkResult = { ok: true; userId: string } | { ok: false; reason: LinkFailure }

/**
 * Скільки разів повторити `consume()` після дедлоку чи гонки за `chatId`,
 * перш ніж чесно повідомити людині «спробуйте ще раз». Дедлок і колізія на
 * `User.telegramChatId` — це не постійне навантаження, а зустріч двох
 * одиничних кліків у вузькому вікні; двох повторів вистачає з великим
 * запасом, а нескінченний retry на HTTP-запиті — сам собою погана ідея.
 */
const MAX_CONSUME_ATTEMPTS = 3

/**
 * §7.4: прив'язка Telegram через deep link.
 *
 * Ручне введення `@username` не використовується не лише тому, що незручно:
 * воно нічого не доводить. Будь-хто може написати чужий нік, і сервіс не має
 * способу перевірити, що акаунт належить саме цій людині. Deep link доводить це
 * структурно — токен видано автентифікованій сесії, а `chat_id` приносить сам
 * Telegram.
 */
@Injectable()
export class TelegramLinkService {
  private readonly logger = new Logger(TelegramLinkService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TelegramConfig,
  ) {}

  /**
   * §8: `POST /me/telegram/link → { deepLink }`.
   *
   * Токен — той самий `generateToken()`, що й для сесій і листів: 32 випадкові
   * байти в base64url. Криптографічна стійкість тут не надмірність — знання
   * токена дає прив'язку чужого акаунта до свого чату, тобто доступ до чужих
   * сповіщень і до інлайн-кнопок під ними.
   *
   * На відміну від токенів зі §6.1, у базу лягає **сирий** токен, а не його геш:
   * так його описує §4.8 (`token String @id`). Компроміс свідомий і вужчий, ніж
   * здається — вікно життя 10 хвилин проти доби в підтвердження пошти, і токен
   * гаситься першим використанням.
   *
   * Гасіння старих токенів і створення нового — **одна** інтерактивна
   * транзакція з `SELECT … FOR UPDATE` на рядку `User`, а не два autocommit-
   * запити поспіль. Без локу дві паралельні спроби (подвійний клік, дві
   * вкладки) читають «старих токенів немає» одночасно — обидві бачать порожньо
   * ще до того, як хоч одна встигла щось видалити чи створити — і лишають по
   * собі ДВА чинні токени, хоча коментар вище обіцяє «останній — єдиний
   * дійсний». Лок серіалізує їх: друга транзакція чекає на першу, а коли
   * дочекається, її власний `deleteMany` уже бачить (і гасить) щойно
   * закомічений токен першої.
   *
   * **Порядок локів — `User`, потім `TelegramLinkToken` — той самий у всіх
   * трьох методах цього сервісу** (`createLink`, `consume`, `unlink`).
   * Раніше `consume()` брав їх у зворотному порядку (спершу claim токена,
   * потім `User`), і це давало класичний deadlock 40P01: `createLink()`
   * тримає лок на `User` і чекає на рядок токена, який щойно захопив
   * `consume()` для того самого користувача, а той — навпаки, чекає на `User`,
   * захоплений `createLink()`. PostgreSQL ловить це сам і рве одну з двох
   * транзакцій; проблема не в тому, яку саме, а в тому, що клієнт, який робив
   * усе правильно (один клік, послідовні дії), міг отримати 500 через чужий
   * паралельний запит. Єдиний порядок прибирає саму можливість циклу очікування.
   *
   * `expiresAt` рахується від часу **бази**, отриманого вже під локом
   * `User`, а не від `Date.now()` у JS до транзакції: якщо виклик постояв у
   * черзі за локом (наприклад, позаду `consume()` для попереднього токена),
   * TTL має відлічуватися від моменту, коли ми справді почали діяти, а не від
   * моменту виклику.
   *
   * Час читається `clock_timestamp()`, а НЕ `now()`/`CURRENT_TIMESTAMP`.
   * PostgreSQL фіксує `now()` на момент **початку транзакції**, а не на
   * момент виконання конкретного запиту — після очікування на `FOR UPDATE`
   * (яке щойно сталося рядком вище) `now()` віддав би час ДО очікування, і
   * TTL, порахований від нього, був би скорочений рівно на тривалість
   * простою в черзі за локом. `clock_timestamp()` — єдина у стандартному
   * наборі функція PostgreSQL, яка справді читає годинник у момент виклику,
   * а не в момент початку транзакції.
   */
  async createLink(userId: string): Promise<TelegramLinkResponse> {
    this.config.assertConfigured()

    const token = generateToken()

    const expiresAt = await this.prisma.$transaction(async (tx) => {
      // Лок на User, а не на TelegramLinkToken: у людини, яка ще жодного разу
      // не тиснула «Підключити», рядків токена немає взагалі, і локувати
      // нема що — а User для автентифікованої сесії існує завжди.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`

      const [nowRow] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      if (nowRow === undefined) throw new Error('SELECT clock_timestamp() не повернув рядка')
      const { now } = nowRow
      const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_TTL_MS)

      // Старі невикористані токени цієї людини гасяться: кнопку могли натиснути
      // тричі, і три живі посилання одночасно — три способи прив'язати три різні
      // чати. Останній натиснутий має бути єдиним дійсним.
      await tx.telegramLinkToken.deleteMany({ where: { userId, usedAt: null } })
      await tx.telegramLinkToken.create({ data: { token, userId, expiresAt } })

      return expiresAt
    })

    return { deepLink: this.config.deepLink(token), expiresAt: expiresAt.toISOString() }
  }

  /**
   * §7.4, крок 4: гасимо токен і зберігаємо `chat_id`.
   *
   * Одноразовість тримає `updateMany` з умовою `usedAt: null` — той самий
   * оптимістичний прийом, яким `AuthService` гасить токени з листів. `count = 0`
   * означає «не існує, прострочений або вже використаний», і всі три випадки
   * дають однакову відповідь: невідомий токен не має відрізнятися від
   * використаного, інакше бот перетворюється на оракул чинності токенів.
   *
   * Причина розрізняється лише для тексту людині — і читається окремим запитом
   * **після** невдалого гасіння, коли гонку вже програно й повідомляти нема чого.
   *
   * **Порядок локів той самий, що в `createLink`/`unlink`: спершу `User`,
   * потім `TelegramLinkToken`.** Раніше цей метод починав із `updateMany` по
   * токену — тобто з протилежного кінця — що й давало deadlock 40P01 проти
   * `createLink()`/`unlink()` того самого користувача (див. коментар там).
   * Але щоб узагалі знати, ЯКОГО `User` локувати, потрібен `userId` — а він
   * лежить у самому рядку токена. Тому послідовність тришарова:
   *
   * 1. Без локу — лише прочитати `userId` із рядка за токеном. Це не є
   *    рішенням про валідність (рядок міг зникнути чи протухнути якраз зараз),
   *    це рівно стільки інформації, скільки треба, щоб узнати, який `User`
   *    локувати далі. Токена немає взагалі — нема кого локувати, і це вже
   *    остаточна відповідь `UNKNOWN_TOKEN`.
   * 2. Лочимо `User` — той самий порядок, що й інші два методи.
   * 3. Лише під локом читаємо **свіжий час бази** (не той, що обчислили б до
   *    очікування на лок) і атомарно клеймимо той самий токен уже з `userId`
   *    у `WHERE`: якщо рядок за час між кроком 1 і локом зник, змінився чи
   *    протух, `count` вийде не 1, і причина перечитується так само, як і
   *    раніше.
   *
   * Свіжий `clock_timestamp()` тут не косметика: якби перевірку
   * `expiresAt > now` робили за часом, узятим ДО очікування на лок `User`
   * (наприклад, поки той тримає паралельний `createLink()` для того самого
   * користувача), токен, що встиг протухнути саме за час цього очікування,
   * пройшов би перевірку за застарілим "now" — тобто прострочене посилання
   * прийнялося б як чинне. `now()` для цього не годиться зовсім — див.
   * коментар над `createLink()`.
   *
   * **Порядок локів прибирає deadlock лише для одного user.** Він не рятує
   * від ДВОХ КОНСУМЕРІВ, які одночасно намагаються переставити `chatId` між
   * собою: `A` забирає чат, яким зараз володіє `B`, водночас `B` забирає чат
   * `A`. Кожна транзакція лочить СВОГО власника токена першою (крок 2), а
   * потім намагається змінити рядок ІНШОГО — того, хто зараз тримає
   * `chatId` (`tx.user.updateMany` нижче). Якщо той інший — це власник
   * токена сусідньої транзакції, яка чекає симетрично, PostgreSQL сам
   * ловить цикл (40P01) і рве одну з двох. Другий, рідший випадок — двоє
   * незалежно тиснуть Start у ТОМУ САМОМУ чаті майже одночасно (два токени
   * на один `chat_id`): тут не цикл очікування, а конфлікт унікального
   * індексу `User_telegramChatId_key` у момент `UPDATE` (P2002) — семантика
   * коду вже й так «останній переміг» (коментар нижче), тож повтор із чистого
   * читання є ПРАВИЛЬНОЮ, а не запасною поведінкою: другий прохід бачить
   * щойно закомічений стан і послідовно забирає `chatId` собі, як і мав би.
   *
   * В обох випадках PostgreSQL/Prisma кидають виняток із самої транзакції —
   * і мовчки повернути вебхуку 200 без жодної відповіді людині тут не можна:
   * той, чий запит справді програв гонку (вичерпав усі спроби), має
   * отримати `CONFLICT` із текстом «спробуйте ще раз», а не зникнути в
   * логах `handle()`.
   */
  async consume(token: string, chatId: string): Promise<LinkResult> {
    // Крок 1: без блокування. Визначає лише, ЧИЙ `User` треба лочити —
    // не є вироком про чинність токена. Валідний для всіх спроб нижче:
    // токен незмінний після створення (лише `usedAt` змінюється), тож
    // перечитувати власника між спробами сенсу немає.
    const owner = await this.prisma.telegramLinkToken.findUnique({
      where: { token },
      select: { userId: true },
    })

    if (owner === null) return { ok: false, reason: 'UNKNOWN_TOKEN' }

    for (let attempt = 1; attempt <= MAX_CONSUME_ATTEMPTS; attempt += 1) {
      try {
        return await this.attemptConsume(token, owner.userId, chatId)
      } catch (error) {
        const retryable =
          isDeadlockOrSerializationFailure(error) ||
          isUniqueViolationOn(error, 'User_telegramChatId_key')

        if (!retryable) throw error

        if (attempt === MAX_CONSUME_ATTEMPTS) {
          this.logger.warn(
            `consume(): вичерпано ${String(MAX_CONSUME_ATTEMPTS)} спроб через дедлок/гонку за chat_id — ${chatId}`,
          )

          return { ok: false, reason: 'CONFLICT' }
        }

        this.logger.warn(
          `consume(): спроба ${String(attempt)} програла дедлок/гонку за chat_id — повторюю`,
        )
      }
    }

    // Недосяжно: цикл або повертає результат, або віддає CONFLICT на останній
    // спробі — але без явного return TS не бачить вичерпності функції.
    return { ok: false, reason: 'CONFLICT' }
  }

  /** Одна спроба `consume()` — тіло транзакції, винесене заради `for`-циклу з ретраями вище. */
  private async attemptConsume(
    token: string,
    ownerId: string,
    chatId: string,
  ): Promise<LinkResult> {
    // ОДНА транзакція на решту: лок User, гасіння токена, відв'язування
    // конфліктного чату й запис `telegramChatId`. Розділені, вони дають
    // найгірший з можливих результатів — токен уже `USED`, а чат не
    // прив'язаний: людина бачить «посилання вже використали» на кнопці, яку
    // натиснула вперше, і виходу з цього стану в неї немає.
    const result = await this.prisma.$transaction<LinkResult>(async (tx) => {
      // Крок 2: лок User — той самий порядок, що в createLink/unlink.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`

      // Крок 3: свіжий час бази — вже під локом, а не до очікування на нього.
      const [nowRow] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      if (nowRow === undefined) throw new Error('SELECT clock_timestamp() не повернув рядка')
      const { now } = nowRow

      const claimed = await tx.telegramLinkToken.updateMany({
        where: { token, userId: ownerId, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })

      if (claimed.count !== 1) {
        // Причина потрібна лише для тексту людині — читається вже після того, як
        // гонку програно, тож на рішення не впливає.
        const row = await tx.telegramLinkToken.findUnique({
          where: { token },
          select: { usedAt: true, expiresAt: true },
        })

        return { ok: false, reason: explain(row, now) }
      }

      // `User.telegramChatId` — `@unique`. Один чат не може обслуговувати два
      // акаунти, тож прив'язка до нового забирає його в попереднього. Без цього
      // друга людина, яка натиснула Start у тому самому чаті, отримала б P2002
      // замість зрозумілої поведінки. Сама ця операція — той рядок, що потребує
      // ретраю на рівні виклику (`consume()`): вона чіпає рядок `User`, чий лок
      // не наш, а того, хто зараз тримає `chatId`.
      await tx.user.updateMany({
        where: { telegramChatId: chatId, id: { not: ownerId } },
        data: { telegramChatId: null },
      })

      await tx.user.update({
        where: { id: ownerId },
        data: { telegramChatId: chatId },
      })

      return { ok: true, userId: ownerId }
    })

    if (result.ok) this.logger.log(`Telegram прив'язано до користувача ${result.userId}`)

    return result
  }

  /**
   * §8: `DELETE /me/telegram`.
   *
   * Теж однією транзакцією: зняття `chat_id` і знецінення невикористаних токенів
   * — половини одного рішення. Якщо друга не відбудеться, посилання, згенероване
   * за хвилину до відв'язки, лишиться робочим і мовчки поверне все назад — а
   * людина вважатиме, що канал вимкнено.
   *
   * `updateMany` по `User` тут і Є локом — той самий порядок `User` →
   * `TelegramLinkToken`, що й у `createLink`/`consume`: рядок дійсно
   * модифікується (умова `telegramChatId: { not: null }` виконана), тож
   * PostgreSQL тримає його заблокованим до кінця транзакції ще до того, як
   * рядок дійде до `TelegramLinkToken.deleteMany`. Гілка `count === 0`
   * (уже відв'язано) взагалі не бере лока — там нема чого захищати від
   * `consume()`, яка того самого User ще не зачепить.
   */
  async unlink(userId: string): Promise<void> {
    const unlinked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, telegramChatId: { not: null } },
        data: { telegramChatId: null },
      })

      if (count === 0) return false

      await tx.telegramLinkToken.deleteMany({ where: { userId, usedAt: null } })

      return true
    })

    if (!unlinked) {
      throw new ApiException(
        API_ERROR_CODES.TELEGRAM_NOT_LINKED,
        'Telegram не підключений',
        HttpStatus.CONFLICT,
      )
    }

    // Налаштування §7.6 лишаються як були. Людина, яка підключить бота знову,
    // очікує побачити свою матрицю, а не скинуту; доставки в цей час однаково не
    // створюються — `channelsFor` перевіряє наявність `chat_id`.
    this.logger.log(`Telegram відв'язано від користувача ${userId}`)
  }
}

/** Чому гасіння не спрацювало. Впливає лише на текст відповіді людині. */
function explain(row: { usedAt: Date | null; expiresAt: Date } | null, now: Date): LinkFailure {
  if (row === null) return 'UNKNOWN_TOKEN'
  if (row.usedAt !== null) return 'USED'
  if (row.expiresAt <= now) return 'EXPIRED'

  // Токен чинний, але гасіння не спрацювало — його забрав паралельний запит.
  return 'USED'
}
