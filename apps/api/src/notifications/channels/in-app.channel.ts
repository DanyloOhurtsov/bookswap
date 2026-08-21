import { Injectable } from '@nestjs/common'
import type { NotificationChannelSender } from './notification-channel'

/**
 * §7.3: `InAppChannel` у списку каналів диспетчера.
 *
 * Надсилати нікуди не треба — рядок `Notification` **і є** in-app доставка, і він
 * уже записаний, у тій самій транзакції, що й перехід (§7.3, правило 1).
 *
 * Тоді навіщо рядок `NotificationDelivery` й канал-порожняк? Заради однієї
 * властивості: «скільки каналів увімкнено — стільки рядків доставки», без
 * винятків. Особливий випадок «для IN_APP рядка не буває» довелося б пам'ятати в
 * трьох місцях — при створенні, у диспетчері та в будь-якому звіті про доставки, —
 * і кожне з них мовчки давало б інші цифри. Один незмінно успішний канал коштує
 * дешевше за три вітки.
 */
@Injectable()
export class InAppChannel implements NotificationChannelSender {
  readonly channel = 'IN_APP' as const

  send(): Promise<void> {
    // Ідемпотентність тут ні до чого: рядок Notification і є доставка, і
    // другого виклику не існує в принципі.
    return Promise.resolve()
  }
}
