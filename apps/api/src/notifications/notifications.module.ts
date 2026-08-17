import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

/**
 * `AuthModule` — заради `SessionGuard` на контролері читання. Запис (`create`)
 * гардів не потребує: його викликають інші сервіси всередині своїх транзакцій.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
