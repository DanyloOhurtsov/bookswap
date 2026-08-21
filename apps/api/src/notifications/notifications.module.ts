import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { EmailChannel } from './channels/email.channel'
import { InAppChannel } from './channels/in-app.channel'
import { NOTIFICATION_CHANNELS } from './channels/notification-channel'
import { TelegramChannel } from './channels/telegram.channel'
import { NotificationDigestService } from './notification-digest.service'
import { NotificationDispatcher } from './notification-dispatcher.service'
import { NotificationPreferencesService } from './notification-preferences.service'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

/**
 * `AuthModule` — заради `SessionGuard` на контролері читання. Запис (`create`)
 * гардів не потребує: його викликають інші сервіси всередині своїх транзакцій.
 *
 * Транспорти (`EMAIL_SENDER`, `TELEGRAM_API`) приходять із глобальних
 * `EmailModule` і `TelegramApiModule`, тож імпортувати їх тут не треба. Саме тому
 * транспорт Telegram винесений окремо від бота: `TelegramModule` залежить від
 * `LoansModule` (§7.4 вимагає той самий `LoanService`), а `LoansModule` — від
 * цього модуля. Спільний модуль дав би цикл.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    NotificationDispatcher,
    NotificationDigestService,
    InAppChannel,
    EmailChannel,
    TelegramChannel,
    {
      /**
       * §7.3: диспетчер тримає список каналів, а не знає їх поіменно. Четвертий
       * канал — це новий рядок тут і новий клас; жодних правок у диспетчері,
       * стейт-машині §5 чи сервісі дружби.
       */
      provide: NOTIFICATION_CHANNELS,
      useFactory: (inApp: InAppChannel, email: EmailChannel, telegram: TelegramChannel) => [
        inApp,
        email,
        telegram,
      ],
      inject: [InAppChannel, EmailChannel, TelegramChannel],
    },
  ],
  exports: [NotificationsService, NotificationDispatcher, NotificationDigestService],
})
export class NotificationsModule {}
