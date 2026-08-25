import { TelegramConfig } from '../src/telegram/telegram.config'
import type { ConfigService } from '@nestjs/config'

/**
 * Значення бота для e2e.
 *
 * Секрет справжньої довжини й дозволених символів — саме той, що пройшов би
 * `env.validation.ts`: тест, який автентифікує вебхук, не має користуватися
 * значенням, яке в проді не піднялося б.
 */
export const TEST_BOT_USERNAME = 'bookswap_test_bot'
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789'

/**
 * `TelegramConfig`, що вважає бота налаштованим.
 *
 * Справжній клас поверх фейкового `ConfigService`, а не заглушка з
 * `matchesWebhookSecret: () => true`: §11 вимагає перевірки авторизації колбеку,
 * і заглушка, яка завжди каже «так», перевіряла б рівно нічого.
 *
 * Разом із ним **обов'язково** підміняється `TELEGRAM_API` — інакше фабрика
 * побачить «бот налаштований» і підніме справжній HTTP-транспорт.
 */
export function configuredTelegram(): TelegramConfig {
  const env: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: '123456:AAFakeToken',
    TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME,
    TELEGRAM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  }

  return new TelegramConfig({ get: (key: string) => env[key] } as unknown as ConfigService)
}
