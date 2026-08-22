import { Module } from '@nestjs/common'
import { MergeService } from './merge.service'

/**
 * §6.3, підетап 7g.
 *
 * У `AppModule` НЕ реєструється: мерж — адмінська операція без HTTP-поверхні,
 * тягнути її в застосунок означало б заводити провайдер, якого ніхто в ньому не
 * викликає. Єдиний споживач — `src/cli/merge-cli.module.ts`; e2e-тести
 * піднімають той самий CLI-модуль, тож перевіряється й саме звʼязування.
 *
 * `PrismaModule` тут не імпортується — він `@Global()`.
 */
@Module({
  providers: [MergeService],
  exports: [MergeService],
})
export class MergeModule {}
