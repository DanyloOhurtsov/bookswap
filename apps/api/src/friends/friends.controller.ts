import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type {
  FriendListResponse,
  FriendRequestsResponse,
  FriendshipStateResponse,
} from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { CreateFriendRequestDto, RespondFriendRequestDto } from './dto/friends.dto'
import { FriendsService } from './friends.service'
import type { UserModel } from '../generated/prisma/models'

/**
 * §11 прямо називає запити в друзі серед того, що треба обмежувати. Тридцять на
 * годину — це стеля для живої людини, яка розбирає коло знайомих, і водночас межа,
 * за якою розсилка перестає бути дешевою.
 */
const FRIEND_REQUEST_LIMIT = { auth: { limit: 30, ttl: 60 * 60_000 } }

/**
 * §8, блок «Дружба».
 *
 * Контролер навмисно тонкий: у ньому немає жодного `FriendshipStatus` і жодної
 * умови про те, кому що можна. Усі переходи — крізь `FriendsService.apply()`,
 * усі питання про доступ — крізь `AccessService`.
 */
@Controller()
@UseGuards(SessionGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get('friends')
  listFriends(@CurrentUser() user: UserModel): Promise<FriendListResponse> {
    return this.friends.listFriends(user.id)
  }

  // Оголошено ДО `friends/:userId`: інакше Express зловить «requests» як id
  // користувача, і ендпоінт запитів стане недосяжним.
  @Get('friends/requests')
  listRequests(@CurrentUser() user: UserModel): Promise<FriendRequestsResponse> {
    return this.friends.listRequests(user.id)
  }

  @Post('friends/requests')
  @UseGuards(ThrottlerGuard)
  @Throttle(FRIEND_REQUEST_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: UserModel,
    @Body() dto: CreateFriendRequestDto,
  ): Promise<FriendshipStateResponse> {
    // Може повернути і REQUEST_SENT, і FRIENDS: зустрічний запит означає згоду.
    return { relation: await this.friends.request(user.id, dto.userId) }
  }

  @Patch('friends/requests/:id')
  async respond(
    @CurrentUser() user: UserModel,
    @Param('id') id: string,
    @Body() dto: RespondFriendRequestDto,
  ): Promise<FriendshipStateResponse> {
    return { relation: await this.friends.respond(user.id, id, dto.action) }
  }

  /**
   * §8: видалення з друзів. Ним же знімається блокування — але лише тим, хто його
   * поставив. Окремого маршруту для розблокування §8 не має, і заводити його понад
   * специфікацію немає підстав: «прибрати звʼязок» — це рівно одна дія.
   *
   * §5.2: активні лоани це не скасовує.
   */
  @Delete('friends/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: UserModel, @Param('userId') userId: string): Promise<void> {
    await this.friends.remove(user.id, userId)
  }

  @Post('friends/:userId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(@CurrentUser() user: UserModel, @Param('userId') userId: string): Promise<void> {
    await this.friends.block(user.id, userId)
  }
}
