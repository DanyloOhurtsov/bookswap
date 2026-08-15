import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './password.service'
import { SessionCleanupService } from './session-cleanup.service'
import { SessionGuard } from './session.guard'
import { SessionService } from './session.service'

/**
 * §6.1: акаунт, серверні сесії, підтвердження пошти, скидання пароля.
 *
 * `SessionService` і `SessionGuard` експортуються, бо захищати маршрути
 * доведеться й іншим модулям. Решта — внутрішня механіка автентифікації.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, SessionGuard, SessionCleanupService],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
