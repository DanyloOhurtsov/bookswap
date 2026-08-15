import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { API_ERROR_CODES } from '@bookswap/shared'
import { ApiException } from '../common/api.exception'
import { SESSION_COOKIE_NAME } from './auth.constants'
import { SessionService } from './session.service'
import type { AuthenticatedRequest } from './authenticated-request'

/**
 * Пропускає лише запити з дійсною сесією (§6.1) і кладе користувача в `request`.
 *
 * Ставиться точково через `@UseGuards`, а не глобально з `@Public()`-винятками:
 * зараз відкритих ендпоінтів більшість, і глобальний захист із дірками читався б
 * гірше, ніж явна позначка на кожному захищеному маршруті.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token: unknown = request.cookies?.[SESSION_COOKIE_NAME]

    if (typeof token !== 'string' || token === '') throw unauthorized()

    const user = await this.sessions.validate(token)

    if (user === null) throw unauthorized()

    request.user = user
    request.sessionToken = token

    return true
  }
}

/**
 * Один код і на «кукі немає», і на «сесія протухла», і на «сесію відкликано».
 * Клієнту в усіх трьох випадках робити те саме — вести на логін.
 */
function unauthorized(): ApiException {
  return new ApiException(
    API_ERROR_CODES.UNAUTHORIZED,
    'Потрібна автентифікація',
    HttpStatus.UNAUTHORIZED,
  )
}
