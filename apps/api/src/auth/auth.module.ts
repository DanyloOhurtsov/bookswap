import { Module } from '@nestjs/common'
import { BACKGROUND_MODE, DEFAULT_BACKGROUND_MODE } from '../common/background'
import { AuthController } from './auth.controller'
import { AUTH_SHUTDOWN_TIMEOUT, AUTH_SHUTDOWN_TIMEOUT_MS } from './auth.constants'
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
 *
 * Бюджет graceful shutdown підключений провайдером, а не читається з константи
 * прямо в сервісі: інакше регресійний тест на вичерпання стелі мусив би або
 * чекати реальні тридцять секунд, або підміняти час — тобто перевіряти вже не
 * той код, що працює в проді. `BACKGROUND_MODE` стоїть тут із тієї самої
 * причини — див. `common/background.ts`.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    SessionGuard,
    SessionCleanupService,
    { provide: AUTH_SHUTDOWN_TIMEOUT, useValue: AUTH_SHUTDOWN_TIMEOUT_MS },
    { provide: BACKGROUND_MODE, useValue: DEFAULT_BACKGROUND_MODE },
  ],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
