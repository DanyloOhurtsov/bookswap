import { Controller, Get } from '@nestjs/common'
import type { HealthResponse } from '@bookswap/shared'
import { HealthService } from './health.service'

/** `GET /api/v1/health` — префікс додається глобально з API_PREFIX. */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthResponse {
    return this.health.check()
  }
}
