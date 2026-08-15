import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { API_PREFIX } from '@bookswap/shared'
import { AllExceptionsFilter } from './common/all-exceptions.filter'

/**
 * Глобальна конфігурація застосунку.
 *
 * Живе окремо від `main.ts` навмисно: e2e-тести піднімають застосунок тим самим
 * викликом, тож перевіряють справжню конфігурацію, а не свою копію.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX)

  // §11: рантайм-валідація DTO через class-validator на кожному ендпоінті.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.useGlobalFilters(new AllExceptionsFilter())
}
