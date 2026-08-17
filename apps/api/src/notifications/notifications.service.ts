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
import { toNotification } from './notifications.mapper'
import type { NotificationType } from '../generated/prisma/enums'

/**
 * Приймає `tx` із чужої транзакції — §7.3, правило 1 вимагає саме цього.
 */
export type NotificationWriter = Pick<PrismaService, 'notification'>

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
}

/**
 * Запис сповіщення — і його читання в застосунку (§7, in-app).
 *
 * §7.3, правило 1: рядок `Notification` створюється в **тій самій транзакції**, що
 * й зміна стану. Інакше падіння після коміту лишає подію без сліду, а падіння до
 * нього — сліди без події. Що це справді так, доводить `loans-rollback.e2e-spec.ts`:
 * він ламає `create` і вимагає, щоб разом із ним відкотився весь перехід.
 *
 * `NotificationDelivery` тут свідомо не створюється. Рядок доставки має сенс лише
 * разом із воркером, який його забирає (§7.3, правило 2); без диспетчера він
 * назавжди лишиться `PENDING` — тобто таблиця черги брехатиме про свій стан.
 * Диспетчер, канали, ретраї й матриця `NotificationPreference` — окремий етап
 * (§14, етап 3).
 *
 * Окремий сервіс, а не `tx.notification.create` просто у викликачів: зараз сюди
 * ходять і дружба, і всі переходи §5.1, і всі мусять лягати в чужу транзакцію
 * однаково.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NotificationInput, client: NotificationWriter = this.prisma): Promise<void> {
    await client.notification.create({
      data: { userId: input.userId, type: input.type, payload: input.payload },
    })
  }

  /**
   * §8: `GET /me/notifications?unread=true`.
   *
   * `unreadCount` рахується завжди, незалежно від фільтра: лічильник у навігації
   * не має залежати від того, яку вкладку зараз відкрито.
   */
  async list(userId: string, filters: NotificationQueryRequest): Promise<NotificationListResponse> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(filters.unread === true ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ])

    return { notifications: rows.map(toNotification), unreadCount }
  }

  /**
   * §8: `PATCH /me/notifications/:id/read`.
   *
   * `updateMany` з умовою `readAt: null` тримає одноразовість запису — той самий
   * оптимістичний прийом, яким `AuthService` гасить токени з листів. Але його
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
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    })

    const row = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } })

    // Чуже й неіснуюче — однаково 404: інакше ендпоінт повідомляє, які id
    // сповіщень існують у базі.
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
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })

    return { updated: count }
  }
}
