import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { UserModel } from '../generated/prisma/models'

/**
 * Запит після `SessionGuard`. Поля необов'язкові саме тому, що до guard'а їх
 * немає — тип не бреше про порядок виконання.
 */
export interface AuthenticatedRequest extends Request {
  user?: UserModel
  sessionToken?: string
}

/**
 * `@CurrentUser()` — користувач із сесії.
 *
 * Кидає, якщо guard не відпрацював: мовчазний `undefined` у контролері перетворив
 * би забутий `@UseGuards` на відкритий ендпоінт, який ще й якось працює.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>()

  if (request.user === undefined) {
    throw new Error('@CurrentUser() без SessionGuard — маршрут лишився незахищеним')
  }

  return request.user
})
