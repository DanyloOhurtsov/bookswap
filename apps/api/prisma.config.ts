import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

/**
 * §12.2: `.env` — ОДИН, у корені репозиторію.
 *
 * Prisma 7 більше не підвантажує `.env` сама (це прибрано разом із Rust-движком),
 * тож змінні читаються тут явно. Шлях саме від файлу конфігурації, а не від cwd:
 * `prisma` запускається і з кореня (через turbo), і з `apps/api`.
 */
loadDotenv({ path: resolve(__dirname, '../../.env'), quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    // Prisma 7 більше не запускає seed автоматично після `migrate dev` — лише
    // `migrate reset` і явний `prisma db seed`.
    seed: 'tsx prisma/seed.ts',
  },

  datasource: {
    /**
     * §4.1: міграції мусять іти через ПРЯМЕ підключення. Вони беруть advisory lock,
     * який не переживає transaction pooling PgBouncer'а.
     *
     * У Prisma 7 поля `directUrl` більше немає — натомість тут живе єдиний URL для
     * CLI (міграції, introspection), і це саме прямий URL. Рантайм-клієнт ходить
     * окремо, через драйвер-адаптер із `DATABASE_URL` (див. `src/prisma/prisma.service.ts`).
     */
    url: env('DIRECT_DATABASE_URL'),
  },
})
