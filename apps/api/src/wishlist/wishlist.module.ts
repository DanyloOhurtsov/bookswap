import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { WishlistController } from './wishlist.controller'
import { WishlistService } from './wishlist.service'

/** §6.5 і §8. `AuthModule` — заради `SessionGuard`, як у `LibraryModule`. */
@Module({
  imports: [AuthModule],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
