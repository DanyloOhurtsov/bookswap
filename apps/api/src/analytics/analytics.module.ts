import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AnalyticsService } from './analytics.service'

/**
 * docs/plan/stage-8-activation.md, 8a-1 — лише сховище й сервіс.
 *
 * `PrismaModule` імпортується явно, хоч він `@Global` (`prisma/prisma.module.ts`)
 * і `PrismaService` був би доступний і без цього: залежність від Prisma тут не
 * випадкова, а те, чому цей модуль взагалі існує, і явний `imports` документує
 * це прямо в модулі, а не лишає читача здогадуватися по глобальності.
 *
 * Навмисно без контролера, endpoint'у, job'и чи таймера (§7) — у 8a-1 жоден
 * доменний сервіс ще не інжектить `AnalyticsService`.
 */
@Module({
  imports: [PrismaModule],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
