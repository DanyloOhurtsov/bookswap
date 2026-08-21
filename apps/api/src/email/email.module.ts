import { Global, Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DevEmailSender } from './dev-email-sender'
import { EMAIL_SENDER } from './email-sender'
import { ResendEmailSender } from './resend-email-sender'
import type { EmailSender } from './email-sender'

/**
 * §7.2: відправка пошти потрібна незалежно від сповіщень — для підтвердження
 * адреси й скидання пароля. Пишеться один раз і використовується для всього:
 * `EmailChannel` зі §7.3 бере цей самий порт.
 *
 * Реалізацію обирає `EMAIL_PROVIDER`, а не `NODE_ENV`. Виведення з середовища
 * означало б, що на стейджі з `NODE_ENV=production` пошта мовчки вимкнена або
 * навпаки — розробник із чужим ключем випадково розсилає справжні листи.
 * `DevEmailSender` при цьому лишається останнім запобіжником: у `production` він
 * не дає застосунку піднятися взагалі.
 */
@Global()
@Module({
  providers: [
    DevEmailSender,
    ResendEmailSender,
    {
      provide: EMAIL_SENDER,
      useFactory: (config: ConfigService, dev: DevEmailSender, resend: ResendEmailSender) => {
        const provider = config.get<string>('EMAIL_PROVIDER') ?? 'dev'
        const sender: EmailSender = provider === 'resend' ? resend : dev

        new Logger('EmailModule').log(`Поштовий провайдер: ${provider}`)

        return sender
      },
      inject: [ConfigService, DevEmailSender, ResendEmailSender],
    },
  ],
  exports: [EMAIL_SENDER, DevEmailSender],
})
export class EmailModule {}
