import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common'
import { API_PREFIX } from '@bookswap/shared'
import cookieParser from 'cookie-parser'
import type { Express } from 'express'
import { AllExceptionsFilter } from './common/all-exceptions.filter'

export interface AppSetupOptions {
  /**
   * Довіряти заголовку `X-Forwarded-For` рівно від одного проксі.
   *
   * За замовчуванням — лише у production, і це не обережність заради обережності.
   * §13.2: у проді перед застосунком стоїть Caddy, тож без `trust proxy` Express
   * бачить IP контейнера проксі — один і той самий для всіх. Rate limiting (§11)
   * тоді рахує спроби входу глобально: перший, хто вичерпає ліміт, замикає вхід
   * усім іншим.
   *
   * Локально ж проксі немає, і `X-Forwarded-For` цілком контролюється клієнтом.
   * Довіряти йому в dev означало б роздати спосіб обійти будь-який ліміт зміною
   * одного заголовка.
   *
   * Саме `1`, а не `true`: довіряється рівно один стрибок — найближчий проксі.
   * З `true` Express бере найлівіший IP із ланцюжка, а туди пише клієнт.
   */
  trustProxy?: boolean
}

/**
 * Глобальна конфігурація застосунку.
 *
 * Живе окремо від `main.ts` навмисно: e2e-тести піднімають застосунок тим самим
 * викликом, тож перевіряють справжню конфігурацію, а не свою копію.
 */
export function configureApp(app: INestApplication, options: AppSetupOptions = {}): void {
  const trustProxy = options.trustProxy ?? process.env.NODE_ENV === 'production'

  if (trustProxy) {
    // `getInstance()` типізований як any — платформа адаптера в сигнатурі не
    // відображена. Звуження безпечне: у проєкті єдиний адаптер — platform-express.
    const express = app.getHttpAdapter().getInstance() as Express

    express.set('trust proxy', 1)
    new Logger('AppSetup').log('trust proxy = 1: IP клієнта береться з X-Forwarded-For')
  }

  app.setGlobalPrefix(API_PREFIX)

  // §6.1: сесія живе в кукі, тож її треба спершу розібрати. Express 5 цього не
  // вміє сам — cookie-parser лишається обов'язковим.
  app.use(cookieParser())

  // §11: рантайм-валідація DTO через class-validator на кожному ендпоінті.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Без цього query-параметри лишаються рядками, а `@IsBoolean`/`@IsIn` на
      // них не спрацьовують так, як описано в DTO.
      transformOptions: { enableImplicitConversion: false },
    }),
  )

  app.useGlobalFilters(new AllExceptionsFilter())
}
