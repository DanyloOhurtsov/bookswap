import { resolve } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnv } from './config/env.validation'
import { HealthModule } from './health/health.module'

/**
 * §12.2: `.env` — один, у корені репозиторію. Шлях однаковий і для `src/`, і для
 * зібраного `dist/` (обидва лежать на одному рівні всередині apps/api).
 */
const ROOT_ENV_PATH = resolve(__dirname, '../../../.env')

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ROOT_ENV_PATH,
      validate: validateEnv,
    }),
    HealthModule,
  ],
})
export class AppModule {}
