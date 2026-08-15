import { Module } from '@nestjs/common'
import { NotificationsService } from './notifications.service'

/**
 * §7. Поки що тут лише запис у таблицю: диспетчер, канали (email, Telegram),
 * ретраї й `NotificationPreference` — окремий етап (§14, етап 3). Модуль
 * заводиться зараз, бо §7.3 вимагає, щоб запис ішов у транзакції зміни стану, —
 * а перші такі зміни з'являються разом із дружбою.
 */
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
