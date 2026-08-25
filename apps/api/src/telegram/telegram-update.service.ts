import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { LoanService } from '../loans/loan.service'
import { PrismaService } from '../prisma/prisma.service'
import { TELEGRAM_API } from './telegram-api'
import { TelegramLinkService, type LinkFailure } from './telegram-link.service'
import {
  chatIdOf,
  isPrivateSender,
  parseLoanCallback,
  parseStartToken,
  telegramUpdateSchema,
  type TelegramCallbackQuery,
  type TelegramMessage,
} from './telegram-update'
import type { TelegramApi } from './telegram-api'

const LINK_FAILURE_TEXT: Record<LinkFailure, string> = {
  UNKNOWN_TOKEN: 'Посилання недійсне. Згенеруйте нове в профілі BookSwap.',
  EXPIRED: 'Посилання протухло — воно живе 10 хвилин. Згенеруйте нове в профілі BookSwap.',
  USED: 'Це посилання вже використали. Згенеруйте нове в профілі BookSwap.',
  // Дедлок або гонка за той самий chat_id з іншим запитом, вичерпані ретраї
  // всередині TelegramLinkService.consume(). Токен НЕ погашено — той самий
  // /start спрацює за секунду, коли конкурент звільнить рядок.
  CONFLICT:
    'Через тимчасове перевантаження запит не вдалося обробити. Спробуйте ще раз за кілька секунд.',
}

/**
 * Обробник оновлень бота (§7.4).
 *
 * Два правила, які тримають цей файл чесним:
 *
 * 1. **Дія з кнопки йде крізь той самий `LoanService.apply()`**, що й дія з вебу.
 *    Паралельної реалізації переходів §5.1 не існує — тому й транзакція, і
 *    блокування `Copy`, і авто-відхилення конкурентів працюють однаково, звідки б
 *    не прийшов запит.
 * 2. **`callback_data` не є авторизацією — і `callback.from.id` теж не є
 *    довіреним `chat_id`.** `callback_data` приходить від клієнта, і в ній може
 *    стояти будь-який `loanId`. `from.id` збігається з `chat_id` приватного
 *    чату лише за конструкцією самого повідомлення (`message.chat.type ===
 *    'private' && message.chat.id === from.id`) — inline-колбек чи колбек із
 *    групи цієї гарантії не дають. Тому `chat_id` виводиться ЛИШЕ з
 *    `callback.message.chat.id`, і лише після перевірки цієї умови, а право на
 *    конкретний примірник перевіряється окремо, **до** виклику сервісу.
 *
 * Жоден метод не кидає назовні: вебхук мусить відповісти 200, інакше Telegram
 * повторюватиме те саме оновлення, доки не здасться.
 */
@Injectable()
export class TelegramUpdateService {
  private readonly logger = new Logger(TelegramUpdateService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: TelegramLinkService,
    private readonly loans: LoanService,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApi,
  ) {}

  async handle(body: unknown): Promise<void> {
    const parsed = telegramUpdateSchema.safeParse(body)

    if (!parsed.success) {
      // Не 400: Telegram повторював би це оновлення знову й знову. У лог іде
      // список полів, а не тіло — у ньому чужі ідентифікатори чатів.
      this.logger.warn(
        `Оновлення не відповідає очікуваній формі: ` +
          parsed.error.issues.map((issue) => issue.path.join('.') || '<корінь>').join(', '),
      )

      return
    }

    const { message, callback_query: callback } = parsed.data

    try {
      if (message !== undefined) await this.onMessage(message)
      if (callback !== undefined) await this.onCallback(callback)
    } catch (error) {
      // Несподівана помилка не має доїжджати до Telegram як 5xx: він читає це як
      // «не дійшло» і повторює те саме оновлення, доки не здасться. Для `/start`
      // це означає ще одне повідомлення людині за кожен повтор, для колбеку —
      // ще одну спробу перейти в той самий стан.
      //
      // Мовчазним ковтанням це не є: помилка йде в лог із рівнем `error` разом зі
      // стектрейсом. У тілі оновлення чужі ідентифікатори чатів, тому воно в лог
      // не потрапляє.
      this.logger.error('Обробка оновлення Telegram упала', error)
    }
  }

  /** §7.4, кроки 3–4: `/start <token>` прив'язує чат до акаунта. */
  private async onMessage(message: TelegramMessage): Promise<void> {
    const chatId = chatIdOf(message.chat.id)
    const token = parseStartToken(message.text)

    // §7.2: спільна група як канал відкинута. Прив'язка до групи зробила б чужі
    // запити видимими всім учасникам, а кнопку «Погодити» — доступною будь-кому
    // з них. Токен при цьому НЕ гаситься: людина, яка помилково кинула посилання
    // в групу, має змогу відкрити його в приватному чаті — інакше єдиною
    // відповіддю сервісу на випадковий клік було б «згенеруйте новий».
    if (token !== null && !isPrivateSender(message)) {
      this.logger.warn(`Спроба прив'язки з неприватного чату (${message.chat.type ?? '?'})`)
      await this.say(
        chatId,
        'Прив’язати акаунт можна лише в приватному чаті з ботом. ' +
          'Відкрийте бота напряму й натисніть Start — посилання ще дійсне.',
      )

      return
    }

    if (token === null) {
      // Будь-яке інше повідомлення. Бот не веде діалогів — він канал доставки.
      if (message.text?.startsWith('/start') === true) {
        await this.say(chatId, 'Відкрийте профіль у BookSwap і натисніть «Підключити Telegram».')
      }

      return
    }

    const result = await this.links.consume(token, chatId)

    if (!result.ok) {
      this.logger.warn(`Прив'язка не вдалася: ${result.reason}`)
      await this.say(chatId, LINK_FAILURE_TEXT[result.reason])

      return
    }

    await this.say(
      chatId,
      'Готово — BookSwap надсилатиме сюди сповіщення.\n\n' +
        'Запити на книжки приходитимуть із кнопками «Погодити» і «Відмовити».',
    )
  }

  /** §7.4: інлайн-кнопки. */
  private async onCallback(callback: TelegramCallbackQuery): Promise<void> {
    const answer = await this.resolveCallback(callback)

    // Відповісти на колбек треба **завжди**: без цього в клієнта Telegram
    // назавжди лишається крутилка на кнопці.
    await this.answer(callback.id, answer.text)

    if (answer.done) await this.stripButtons(callback, answer.text)
  }

  private async resolveCallback(
    callback: TelegramCallbackQuery,
  ): Promise<{ text: string; done: boolean }> {
    // Крок 0. §7.4: «Не трактуй `callback_data` як довірене» — і те саме
    // стосується `callback.from.id`. У приватному чаті `chat.id` дорівнює
    // `from.id` за конструкцією Telegram, але це властивість ПОВІДОМЛЕННЯ, а
    // не самого `from`: інлайн-колбек (`callback.message === undefined`,
    // натиснутий під повідомленням у чужому inline-режимі) і колбек із групи
    // (`chat.type !== 'private'`) обидва мають `from.id`, який анічого не
    // доводить про приватний чат жодної людини. Довіреним джерелом `chat_id`
    // є ЛИШЕ `callback.message.chat.id` — і лише тоді, коли `chat.type ===
    // 'private'` і сам Telegram підтверджує, що це чат саме з тим, хто
    // натиснув (`chat.id === from.id`).
    const message = callback.message

    if (message === undefined) {
      this.logger.warn('Колбек без message (inline-режим) — авторизувати нема з чого')

      return { text: 'Ця дія недоступна для inline-повідомлень.', done: false }
    }

    if (message.chat.type !== 'private' || message.chat.id !== callback.from.id) {
      this.logger.warn(`Колбек поза приватним чатом 1:1 (${message.chat.type ?? '?'}) — відхилено`)

      return { text: 'Ця дія доступна лише в приватному чаті з ботом.', done: false }
    }

    const chatId = chatIdOf(message.chat.id)

    // Крок 1. Хто це. `chat_id` — верифікований вище, з `message.chat.id`, а
    // не сирий `callback.from.id`.
    const actor = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      select: { id: true },
    })

    if (actor === null) {
      return { text: 'Цей чат не прив’язаний до акаунта BookSwap.', done: false }
    }

    // Крок 2. Форма рядка. Розбір нічого не авторизує — `loanId` тут усе ще
    // неперевірене значення від клієнта.
    const parsed = parseLoanCallback(callback.data)

    if (parsed === null) {
      this.logger.warn(`Невідома callback_data від чату ${chatId}`)

      return { text: 'Невідома дія.', done: false }
    }

    // Крок 3. §7.4: «обробник **зобов'язаний** перевірити, що `chat_id`, з якого
    // прийшов колбек, належить власнику саме цього примірника».
    //
    // Власник читається з `Copy`, а не з денормалізованого `Loan.ownerId` (§4.6):
    // формулювання §7.4 говорить саме про власника примірника, і якщо два поля
    // колись розійдуться, право має визначати річ, а не її копія в лоані.
    const loan = await this.prisma.loan.findUnique({
      where: { id: parsed.loanId },
      select: { id: true, copy: { select: { ownerId: true } } },
    })

    if (loan === null || loan.copy.ownerId !== actor.id) {
      // Однакова відповідь на «немає» і «чуже»: інакше кнопка стає способом
      // перевіряти, які `loanId` існують у базі. У лог — факт спроби.
      this.logger.warn(`Чат ${chatId} спробував дію ${parsed.action} на чужому лоані`)

      return { text: 'Цей запит уже не ваш або не існує.', done: false }
    }

    // Крок 4. Той самий сервісний метод, що й у вебі (§7.4).
    try {
      await this.loans.apply(actor.id, parsed.loanId, { action: parsed.action })
    } catch (error) {
      return { text: reason(error), done: false }
    }

    return {
      text: parsed.action === 'approve' ? 'Погоджено ✅' : 'Відхилено ✖️',
      done: true,
    }
  }

  /**
   * Прибирає кнопки після ухваленого рішення.
   *
   * Не косметика: кнопки, що лишилися, — це запрошення натиснути ще раз, а
   * повторне натискання дасть `LOAN_INVALID_TRANSITION` і виглядатиме як поломка.
   */
  private async stripButtons(callback: TelegramCallbackQuery, outcome: string): Promise<void> {
    const message = callback.message

    if (message?.text === undefined) return

    await this.edit(chatIdOf(message.chat.id), message.message_id, `${message.text}\n\n${outcome}`)
  }

  /**
   * Виклики Bot API з відповіді на вебхук нічого не мають права зламати: тіло
   * запиту вже оброблено, стан лоану вже змінено, і невдача при малюванні тексту
   * не привід просити Telegram надіслати оновлення ще раз.
   */
  private async say(chatId: string, text: string): Promise<void> {
    try {
      await this.telegram.sendMessage({ chatId, text, buttons: [] })
    } catch (error) {
      this.logger.error('Не вдалося відповісти в Telegram', error)
    }
  }

  private async answer(callbackQueryId: string, text: string): Promise<void> {
    try {
      await this.telegram.answerCallbackQuery({ callbackQueryId, text })
    } catch (error) {
      this.logger.error('Не вдалося відповісти на колбек', error)
    }
  }

  private async edit(chatId: string, messageId: number, text: string): Promise<void> {
    try {
      await this.telegram.editMessageText({ chatId, messageId, text })
    } catch (error) {
      this.logger.error('Не вдалося прибрати кнопки', error)
    }
  }
}

/**
 * Доменна відмова §5 → текст на кнопці.
 *
 * `ApiException` несе повідомлення, написане для людини, — його й показуємо.
 * Усе інше — несподіванка, і показувати її текст назовні не можна: там може бути
 * що завгодно, від SQL до шляхів у файловій системі.
 */
function reason(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse()

    // `getResponse()` віддає `string | object`; звуження до об'єкта з `message`
    // робить сам `in`, тож приведення типу тут було б зайвим.
    if (typeof response === 'object' && 'message' in response) {
      return String(response.message)
    }
  }

  return 'Не вдалося виконати дію. Спробуйте на сайті.'
}
