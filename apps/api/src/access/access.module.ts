import { Module } from '@nestjs/common'
import { AccessService } from './access.service'

/**
 * §9 в одному місці.
 *
 * Модуль навмисно не `@Global`: залежність від нього має бути видимою в
 * `imports` кожного, хто питає про доступ. Глобальність тут зекономила б рядок і
 * сховала б те, що варто бачити, — які саме модулі приймають рішення про видимість.
 */
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
