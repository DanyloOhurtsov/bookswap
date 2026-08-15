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
