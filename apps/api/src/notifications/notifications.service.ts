import { HttpStatus, Injectable } from '@nestjs/common'
import {
  API_ERROR_CODES,
  type NotificationListResponse,
  type NotificationQueryRequest,
  type NotificationResponse,
  type ReadAllResponse,
} from '@bookswap/shared'
import { ApiException } from '../common/api.exception'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationDispatcher } from './notification-dispatcher.service'
import { NotificationPreferencesService } from './notification-preferences.service'
import { toNotification } from './notifications.mapper'
import type { NotificationType } from '../generated/prisma/enums'

/**
 * Приймає `tx` із чужої транзакції — §7.3, правило 1 вимагає саме цього.
 *
 * Моделей чотири, бо в одній транзакції з переходом стану лягає не лише подія, а
 * й рядки її доставки: щоб їх скласти, треба знати матрицю §7.6 і чи прив'язаний
 * Telegram. Читання «на потім», уже після коміту, дало б вікно, в якому користувач
 * вимкнув канал, а лист однаково пішов.
 */
export type NotificationWriter = Pick<
  PrismaService,
  'notification' | 'notificationDelivery' | 'notificationPreference' | 'user'
>

/**
 * `payload` §4.8 — «loanId, copyId, actorId тощо». Рядки, а не довільний JSON:
 * усі корисні поля тут — це id, а вужчий тип позбавляє потреби в `any` на межі
 * з `Prisma.InputJsonValue`.
 */
export type NotificationPayload = Record<string, string>

export interface NotificationInput {
  /** Кому. */
  userId: string
  type: NotificationType
  payload: NotificationPayload
  /**
   * §7.5: ключ ідемпотентності щоденного дайджесту, `<userId>:<type>:<YYYY-MM-DD>`.
   *
   * Для негайних подій — `undefined`: вони не дедуплікуються, бо кожен перехід
   * §5.1 це окрема подія, навіть якщо два з них однакові.
   */
  digestKey?: string
}

/**
 * Запис сповіщення — і його читання в застосунку (§7, in-app).
 *
 * §7.3, правило 1: рядок `Notification` **і рядки його доставок** створюються в
 * тій самій транзакції, що й зміна стану. Інакше падіння після коміту лишає подію
 * без сліду, а падіння до нього — сліди без події. Що це справді так, доводить
 * `loans-rollback.e2e-spec.ts`: він ламає `create` і вимагає, щоб разом із ним
 * відкотився весь перехід.
 *
 * Транзакція обов'язкова й тоді, коли своєї немає. Подія без доставок недосяжна
 * для жодного каналу — вона просто зникає з життя людини, лишаючись у базі. Тому
 * без переданого клієнта метод відкриває транзакцію сам, а не робить два окремі
 * коміти: саме так його викликає дайджест.
 *
 * Фактична відправка — **після** коміту й тільки з диспетчера (§7.3, правило 2).
 * Тут не виконується жодного мережевого виклику: падіння SMTP не має права
 * відкотити апрув, а транзакція, яка чекає на чужий HTTP, тримає лок на `Copy`
 * рівно стільки, скільки той HTTP триває.
 *
 * Окремий сервіс, а не `tx.notification.create` просто у викликачів: сюди ходять
 * і дружба, і всі переходи §5.1, і щоденний дайджест — і всі мусять лягати в чужу
 * транзакцію однаково.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /**
   * Подія + по рядку доставки на кожен увімкнений і доступний канал (§7.3).
   *
   * Порожній список каналів можливий — усі три вимкнені матрицею §7.6 або
   * недоступні (немає прив'язки, не підтверджена пошта). Рядок `Notification`
   * при цьому створюється однаково: він і є історія, а не лише привід надіслати.
   */
  async create(input: NotificationInput, client?: NotificationWriter): Promise<void> {
    if (client !== undefined) {
      await this.write(input, client)

      return
    }

    // Своєї транзакції немає — відкриваємо власну. Без неї подія й доставки
    // комітяться окремо, і збій між ними лишає сповіщення, якого ніхто не
    // побачить і не отримає.
    await this.prisma.$transaction(async (tx) => {
      await this.write(input, tx)
    })
  }

  private async write(input: NotificationInput, client: NotificationWriter): Promise<void> {
    const notification = await client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        payload: input.payload,
        digestKey: input.digestKey ?? null,
      },
      select: { id: true },
    })

    const channels = await this.preferences.channelsFor(input.userId, input.type, client)

    await client.notificationDelivery.createMany({
      data: channels.map((channel) => ({ notificationId: notification.id, channel })),
    })
  }

  /**
   * §7.3: «після коміту: подія».
   *
   * Диспетчер і так прокидається раз на 30 секунд, тож це не механізм доставки, а
   * усунення затримки: без поштовху власник побачив би запит у Telegram у
   * середньому через чверть хвилини після натискання, і §7.1 («сповіщення тут не
   * зручність, а механізм, що робить продукт робочим») від цього помітно тьмяніє.
   *
   * Викликається **після** повернення з `$transaction` — саме тому це окремий
   * метод, а не хвіст `create()`: усередині транзакції «після коміту» не існує, а
   * поштовх, надісланий до нього, розбудив би диспетчер на рядки, яких ще не видно.
   *
   * Нічого не чекає й нічого не кидає: невдалий тик — це не помилка дії
   * користувача, і перехід лоану через неї падати не має.
   */
  dispatchSoon(): void {
    this.dispatcher.wake()
  }

  /**
   * §8: `GET /me/notifications?unread=true`.
   *
   * Показуються лише події, для яких створювалася **`IN_APP`-доставка**. Це не
   * оптимізація запиту, а прямий наслідок того, що `IN_APP` — повноправна
   * клітинка матриці §7.6: людина, яка вимкнула in-app і лишила Telegram, не
   * має бачити ці події в списку й у лічильнику непрочитаних.
   *
   * Фільтр дивиться на рядок доставки, а не на поточне налаштування, і це
   * важливо: зміна перемикача діє на майбутні події, а не переписує минулі.
   * Інакше вимкнення in-app мовчки стирало б історію, яку людина вже бачила.
   *
   * `unreadCount` рахується завжди, незалежно від фільтра: лічильник у навігації
   * не має залежати від того, яку вкладку зараз відкрито.
   */
  async list(userId: string, filters: NotificationQueryRequest): Promise<NotificationListResponse> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { ...inAppOf(userId), ...(filters.unread === true ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where: { ...inAppOf(userId), readAt: null } }),
    ])

    return { notifications: rows.map(toNotification), unreadCount }
  }

  /**
   * §8: `PATCH /me/notifications/:id/read`.
   *
   * `updateMany` з умовою `readAt: null` тримає одноразовість запису, але його
   * `count = 0` означає **три різні речі**: уже прочитане, неіснуюче або чуже.
   * Тому після запису рядок перечитується за парою `{ id, userId }` — вона ж і
   * фільтр власності, і джерело відповіді.
   *
   * Різниця важлива для клієнта: повторне натискання (або дві вкладки) мусить
   * лишатися успішним, а чуже сповіщення — давати 404. Один лише `count` звів би
   * обидва випадки до однієї помилки.
   */
  async markRead(userId: string, notificationId: string): Promise<NotificationResponse> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, ...inAppOf(userId), readAt: null },
      data: { readAt: new Date() },
    })

    const row = await this.prisma.notification.findFirst({
      where: { id: notificationId, ...inAppOf(userId) },
    })

    // Чуже, неіснуюче й те, що не має in-app доставки, — однаково 404: інакше
    // ендпоінт повідомляє, які id сповіщень існують у базі.
    if (row === null) {
      throw new ApiException(
        API_ERROR_CODES.NOT_FOUND,
        'Сповіщення не знайдено',
        HttpStatus.NOT_FOUND,
      )
    }

    return { notification: toNotification(row) }
  }

  /** §8: `POST /me/notifications/read-all`. Повторний виклик віддає `0` — і це правда. */
  async markAllRead(userId: string): Promise<ReadAllResponse> {
    const { count } = await this.prisma.notification.updateMany({
      where: { ...inAppOf(userId), readAt: null },
      data: { readAt: new Date() },
    })

    return { updated: count }
  }
}

/**
 * «Сповіщення цієї людини, які справді потрапили в застосунок».
 *
 * Винесено в одне місце, бо трьом методам центру сповіщень потрібна та сама
 * умова, а розійтися їм не можна: список, лічильник і позначення прочитаним, що
 * бачать різні набори подій, — це вже не фільтр, а баг.
 */
function inAppOf(userId: string) {
  return { userId, deliveries: { some: { channel: 'IN_APP' as const } } }
}
