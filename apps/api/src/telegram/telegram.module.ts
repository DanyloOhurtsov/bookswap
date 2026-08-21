import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { LoansModule } from '../loans/loans.module'
import { TelegramController } from './telegram.controller'
import { TelegramLinkService } from './telegram-link.service'
import { TelegramUpdateService } from './telegram-update.service'
import { TelegramWebhookController } from './telegram-webhook.controller'

/**
 * §7.4: бот — прив'язка, вебхук, інлайн-кнопки.
 *
 * `LoansModule` тут обов'язковий і принциповий: §7.4 вимагає, щоб дія з кнопки
 * проходила крізь **той самий** сервісний метод, що й дія з вебу. Паралельної
 * реалізації переходів §5.1 не існує, і саме ця залежність це зафіксовує.
 *
 * Транспорт (`TELEGRAM_API`) приходить із глобального `TelegramApiModule` — він
 * винесений окремо, щоб `NotificationsModule` міг ним користуватися, не тягнучи
 * за собою лоани (інакше вийшов би цикл; деталі — в `telegram-api.module.ts`).
 */
@Module({
  imports: [AuthModule, LoansModule],
  controllers: [TelegramController, TelegramWebhookController],
  providers: [TelegramLinkService, TelegramUpdateService],
  exports: [TelegramLinkService],
})
export class TelegramModule {}
