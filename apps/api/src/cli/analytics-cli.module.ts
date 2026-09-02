import { resolve } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AnalyticsModule } from '../analytics/analytics.module'
import { validateEnv } from '../config/env.validation'

const ROOT_ENV_PATH = resolve(__dirname, '../../../../.env')

/** Minimal application context for read-only product analytics reports. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ROOT_ENV_PATH,
      validate: validateEnv,
    }),
    AnalyticsModule,
  ],
})
export class AnalyticsCliModule {}
