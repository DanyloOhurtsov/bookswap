import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import type {
  NotificationListResponse,
  NotificationResponse,
  ReadAllResponse,
} from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { NotificationQueryDto } from './dto/notification.dto'
import { NotificationsService } from './notifications.service'
import type { UserModel } from '../generated/prisma/models'

/**
 * §8, блок «Сповіщення» — поки лише in-app (§14, етап 2).
 *
 * Маршрутів налаштувань «тип × канал» і привʼязки Telegram тут немає навмисно:
 * без диспетчера вони описували б доставку, якої не існує.
 */
@Controller()
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
}
