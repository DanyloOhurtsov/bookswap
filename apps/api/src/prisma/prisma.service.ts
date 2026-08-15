import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

/**
 * Єдина точка життєвого циклу підключення до PostgreSQL.
 *
 * Prisma 7 не має вбудованих драйверів (Rust-движок прибрано), тож підключення
 * йде через драйвер-адаптер `@prisma/adapter-pg` поверх `pg`. Рантайм бере
 * `DATABASE_URL` — у проді це підключення через PgBouncer. Міграції ходять іншим
 * шляхом, через `DIRECT_DATABASE_URL` у `prisma.config.ts` (§4.1).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
    })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
    this.logger.log('Підключення до PostgreSQL встановлено')
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
