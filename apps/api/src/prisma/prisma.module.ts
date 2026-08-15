import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

/**
 * `@Global`, бо доступ до БД потрібен майже кожному доменному модулю наступних
 * етапів, а альтернатива — імпорт цього модуля в кожному з них — лише шум.
 * Обгортати `PrismaService` репозиторіями «на майбутнє» тут навмисно не будемо.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
