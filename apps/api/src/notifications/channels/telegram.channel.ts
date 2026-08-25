import { Inject, Injectable } from '@nestjs/common'
import { TELEGRAM_API } from '../../telegram/telegram-api'
import type { TelegramApi } from '../../telegram/telegram-api'
import type {
  DeliveryRecipient,
  NotificationChannelSender,
  RenderedNotification,
} from './notification-channel'

/**
 * §7.2 і §7.4: Telegram із інлайн-кнопками.
 *
 * Саме кнопки роблять цей канал основним на практиці: власник відповідає на запит
 * прямо з повідомлення, минаючи ланцюг «відкрити сайт → залогінитись → знайти
 * запит». Що станеться після натискання — не справа каналу: він лише малює кнопки
 * з `callback_data`, які склав рендерер (§7.3, «канал не має знати про лоани»).
 */
@Injectable()
export class TelegramChannel implements NotificationChannelSender {
  readonly channel = 'TELEGRAM' as const

  constructor(@Inject(TELEGRAM_API) private readonly telegram: TelegramApi) {}

  /**
   * `deliveryId` не використовується: Bot API не має поняття ключа
   * ідемпотентності для `sendMessage`. Межа з провайдером тут — чисте
   * at-least-once, без пом'якшення; §7.3 приймає це як відому властивість
   * каналу, а не як недогляд.
   */
  async send(recipient: DeliveryRecipient, message: RenderedNotification): Promise<void> {
    if (recipient.telegramChatId === null) {
      // Сюди дійти не мало б: рядок доставки для `TELEGRAM` створюється лише за
      // наявного `chat_id`. Але прив'язку можна зняти між створенням рядка й
      // спробою надіслати, і тоді ретраї не допоможуть — надсилати просто нікуди.
      // Явна помилка з поясненням у `NotificationDelivery.error` краща за
      // `undefined` у чужому HTTP-клієнті.
      throw new Error('Telegram не прив’язаний: chat_id порожній')
    }

    await this.telegram.sendMessage({
      chatId: recipient.telegramChatId,
      // Тема окремим полем у Telegram не потрібна — там це просто перший рядок,
      // який рендерер уже поставив у `body`.
      text: message.body,
      buttons: message.actions.map((action) => ({
        text: action.label,
        callbackData: action.data,
      })),
    })
  }
}
