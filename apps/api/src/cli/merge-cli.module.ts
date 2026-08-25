import { resolve } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MergeModule } from '../catalog/merge/merge.module'
import { validateEnv } from '../config/env.validation'
import { PrismaModule } from '../prisma/prisma.module'

/**
 * §12.2: `.env` — один, у корені репозиторію.
 *
 * Чотири рівні вгору, а не три як в `AppModule`: цей файл лежить на рівень
 * глибше (`src/cli/`), і шлях однаковий для `src/cli` та `dist/cli`.
 */
const ROOT_ENV_PATH = resolve(__dirname, '../../../../.env')

/**
 * Мінімальний контекст під адмінську команду мержу (підетап 7g).
 *
 * `AppModule` тут навмисно не використовується: він підняв би диспетчер
 * сповіщень, дайджест, Telegram-бота й HTTP-шар заради однієї транзакції — а
 * заразом дав би їм шанс щось надіслати посеред адмінської операції.
 *
 * Валідація оточення лишається тією самою (`validateEnv`): команда ходить у ту
 * саму базу, що й застосунок, і мовчазний запуск із порожнім `DATABASE_URL`
 * тут ще небезпечніший, ніж на старті сервера.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ROOT_ENV_PATH,
      validate: validateEnv,
    }),
    PrismaModule,
    MergeModule,
  ],
})
export class MergeCliModule {}
