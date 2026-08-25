import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import type { WishlistItemResponse, WishlistResponse } from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { AddWishlistItemDto } from './dto/wishlist.dto'
import { WishlistService } from './wishlist.service'
import type { UserModel } from '../generated/prisma/models'

/** §8, блок «Вішлист» (§6.5, підетап 7e). */
@Controller()
@UseGuards(SessionGuard)
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get('me/wishlist')
  list(@CurrentUser() user: UserModel): Promise<WishlistResponse> {
    return this.wishlist.list(user.id)
  }

  /**
   * Ідемпотентно (DoD 7e): і перше, і повторне додавання того самого твору
   * відповідають 200 з тим самим пунктом — «створено» і «вже було» тут не
   * різні результати з погляду клієнта.
   */
  @Post('me/wishlist')
  @HttpCode(HttpStatus.OK)
  add(
    @CurrentUser() user: UserModel,
    @Body() dto: AddWishlistItemDto,
  ): Promise<WishlistItemResponse> {
    return this.wishlist.add(user.id, dto.workId)
  }

  @Delete('me/wishlist/:workId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: UserModel, @Param('workId') workId: string): Promise<void> {
    await this.wishlist.remove(user.id, workId)
  }
}
