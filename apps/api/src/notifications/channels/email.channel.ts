import { Inject, Injectable } from '@nestjs/common'
import { EMAIL_SENDER } from '../../email/email-sender'
import type { EmailSender } from '../../email/email-sender'
import type {
  DeliveryRecipient,
  NotificationChannelSender,
  RenderedNotification,
} from './notification-channel'

/**
 * §7.2: «email — базовий канал».
 *
 * Той самий `EmailSender`, яким `AuthService` надсилає підтвердження адреси й
 * скидання пароля. Це і є причина, чому §7.2 узагалі бере пошту: «інфраструктура
 * відправки потрібна незалежно… тобто відправка пишеться один раз і
 * використовується для всього». Окремий поштовий клієнт під сповіщення означав би
 * дві конфігурації відправника, з яких у проді неминуче протухне одна.
 *
 * Ретраїв тут немає: за них відповідає диспетчер, і другий шар повторів
 * усередині каналу зробив би `attempts` у таблиці неправдою.
 */
@Injectable()
export class EmailChannel implements NotificationChannelSender {
  readonly channel = 'EMAIL' as const

  constructor(@Inject(EMAIL_SENDER) private readonly email: EmailSender) {}

  async send(
    recipient: DeliveryRecipient,
    message: RenderedNotification,
    deliveryId: string,
  ): Promise<void> {
    if (!recipient.emailVerified) {
      // Сюди дійти не мало б: рядок доставки для непідтвердженої адреси не
      // створюється. Але підтвердження можна втратити (зміна пошти) між
      // створенням рядка й спробою — і тоді надсилати не можна: ніхто не довів,
      // що цю скриньку читає саме адресат.
      throw new Error('Адресу не підтверджено — лист не надсилається')
    }

    // Кнопки (`message.actions`) ігноруються: у листі їх нема як показати, а
    // текст §7.3 рендерить самодостатнім саме на цей випадок.
    //
    // `deliveryId` — ключ ідемпотентності: якщо `Promise.race` у диспетчері
    // покинув попередній виклик за таймаутом, а той усе одно дійшов до
    // провайдера, повторна спроба з тим самим ключем має шанс не подвоїти лист.
    await this.email.send({
      to: recipient.email,
      subject: message.subject,
      body: message.body,
      idempotencyKey: deliveryId,
    })
  }
}
