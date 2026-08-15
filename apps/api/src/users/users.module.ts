import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module'
import { AuthModule } from '../auth/auth.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

/**
 * Профіль (`/me`) і пошук людей (`/users`).
 *
 * `AccessModule` — заради стану звʼязку в результатах пошуку: «додати в друзі» чи
 * «вже друзі» вирішує він, а не фронт.
 */
@Module({
  imports: [AuthModule, AccessModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
