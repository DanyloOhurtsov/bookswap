import { Global, Module } from '@nestjs/common'
import { DevEmailSender } from './dev-email-sender'
import { EMAIL_SENDER } from './email-sender'

/**
 * §7.2: відправка пошти потрібна незалежно від сповіщень — для підтвердження
 * адреси й скидання пароля. Пишеться один раз і використовується для всього.
 *
 * Поки що прив'язка одна: `EMAIL_SENDER` → `DevEmailSender`. Вибір реалізації за
 * оточенням з'явиться разом із самою реалізацією (етап 3), а не наперед.
 */
@Global()
@Module({
  providers: [DevEmailSender, { provide: EMAIL_SENDER, useExisting: DevEmailSender }],
  exports: [EMAIL_SENDER, DevEmailSender],
})
export class EmailModule {}
