import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
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
 * Запис сповіщення — і поки що лише запис.
 *
 * §7.3, правило 1: рядок `Notification` створюється в **тій самій транзакції**, що
 * й зміна стану. Інакше падіння після коміту лишає подію без сліду, а падіння до
 * нього — сліди без події.
 *
 * `NotificationDelivery` тут свідомо не створюється. Рядок доставки має сенс лише
 * разом із воркером, який його забирає (§7.3, правило 2); без диспетчера він
 * назавжди лишиться `PENDING` — тобто таблиця черги брехатиме про свій стан.
 * Диспетчер, канали й ретраї — окремий етап (§14, етап 3).
 *
 * Окремий сервіс, а не `tx.notification.create` просто в `FriendsService`: зараз
 * два виклики, на етапі лоанів буде ще сім (§7.5), і всі мусять лягати в чужу
 * транзакцію однаково.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NotificationInput, client: NotificationWriter = this.prisma): Promise<void> {
    await client.notification.create({
      data: { userId: input.userId, type: input.type, payload: input.payload },
    })
  }
}
