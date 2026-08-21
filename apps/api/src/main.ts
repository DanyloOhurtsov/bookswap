import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { API_PREFIX } from '@bookswap/shared'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)

  // Без цього SIGTERM/SIGINT просто вбивають процес — Nest НЕ викликає
  // onModuleDestroy() сам собою на сигнал, лише на явний app.close(). За
  // замовчуванням підписується на SIGTERM і SIGINT (типовий сигнал деплою й
  // Ctrl+C); саме через них graceful shutdown узагалі стає можливим для
  // NotificationDispatcher, NotificationDigestService й AuthService нижче —
  // усі три чекають активну роботу саме в onModuleDestroy(), і без хука цей
  // код ніколи не встиг би спрацювати до того, як процес зникне.
  //
  // Зворотний бік теж свідомий: якщо auth-дренаж не вкладеться в загальний
  // бюджет (`AUTH_SHUTDOWN_TIMEOUT_MS`), onModuleDestroy кине
  // AuthShutdownTimeoutError, Nest запише ERROR_DURING_SHUTDOWN і одразу
  // викличе process.exit(1). Невдала зупинка має бути видимою оператору, а не
  // замаскованою під штатну — але саме тому вона й не «доводить роботу до
  // кінця»: process.exit(1) не чекає нікого, тож workflow, який на той момент
  // іще виконувався, обривається, і в базі можливі часткові side effects. Межа
  // описана в AuthService.onModuleDestroy і в README («Пошта й підтвердження»).
  app.enableShutdownHooks()

  // Значення береться з провалідованого оточення, а не з сирого process.env:
  // за Caddy (§13.2) без цього rate limiting рахував би всіх як один IP.
  configureApp(app, { trustProxy: config.get<string>('NODE_ENV') === 'production' })

  app.enableCors({
    origin: config.getOrThrow<string>('WEB_ORIGIN'),
    credentials: true,
  })

  // §13.1: порт через env, не хардкодом. Значення вже провалідоване (дефолт 3001).
  const port = config.getOrThrow<number>('PORT')
  await app.listen(port)

  new Logger('Bootstrap').log(`API слухає http://localhost:${port}${API_PREFIX}`)
}

void bootstrap()
