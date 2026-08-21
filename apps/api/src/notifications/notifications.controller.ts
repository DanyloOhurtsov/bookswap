import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import type {
  NotificationListResponse,
  NotificationPreferencesResponse,
  NotificationResponse,
  ReadAllResponse,
} from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto'
import { NotificationQueryDto } from './dto/notification.dto'
import { NotificationPreferencesService } from './notification-preferences.service'
import { NotificationsService } from './notifications.service'
import type { UserModel } from '../generated/prisma/models'

/**
 * §8, блок «Сповіщення»: читання in-app і матриця «тип × канал» (§7.6).
 *
 * Прив'язка Telegram живе в окремому контролері (`telegram/`), і не через розмір
 * файлу: її маршрути ділять код і конфігурацію з вебхуком бота, який автентифікує
 * не сесія, а секрет Telegram, — тобто мають іншу модель доступу.
 */
@Controller()
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  // Статичний сегмент оголошений перед `:id` — інакше `/me/notifications/read-all`
  // прочитається як сповіщення з id «read-all».
  @Post('me/notifications/read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentUser() user: UserModel): Promise<ReadAllResponse> {
    return this.notifications.markAllRead(user.id)
  }

  @Get('me/notifications')
  list(
    @CurrentUser() user: UserModel,
    @Query() dto: NotificationQueryDto,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(user.id, dto)
  }

  @Patch('me/notifications/:id/read')
  read(
    @CurrentUser() user: UserModel,
    @Param('id') notificationId: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(user.id, notificationId)
  }

  /** §8: `GET /me/notification-preferences`. Уся матриця, включно з дефолтами §7.6. */
  @Get('me/notification-preferences')
  getPreferences(@CurrentUser() user: UserModel): Promise<NotificationPreferencesResponse> {
    return this.preferences.get(user.id)
  }

  /**
   * §8: `PUT /me/notification-preferences`.
   *
   * `PUT`, бо клієнт надсилає стан клітинок, а не інструкцію їх змінити, і
   * повторний однаковий запит нічого не змінює. Заміни всієї матриці при цьому не
   * відбувається — див. контракт у `shared`.
   */
  @Put('me/notification-preferences')
  updatePreferences(
    @CurrentUser() user: UserModel,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    return this.preferences.update(user.id, dto)
  }
}
