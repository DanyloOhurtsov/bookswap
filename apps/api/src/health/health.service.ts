import { Injectable } from '@nestjs/common'
import type { HealthResponse } from '@bookswap/shared'

/** Версія, яку API повідомляє назовні. */
const API_VERSION = '0.1.0'

@Injectable()
export class HealthService {
  /**
   * Свідомо не звертається до бази: на цьому етапі Prisma ще не підключена, а
   * health має відповідати й тоді, коли PostgreSQL не запущений. Перевірка
   * залежностей додасться разом із самими залежностями.
   */
  check(): HealthResponse {
    return {
      status: 'ok',
      version: API_VERSION,
      uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
    }
  }
}
