import { Global, Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { FakeTelegramApi } from './fake-telegram-api'
import { HttpTelegramApi } from './http-telegram-api'
import { TELEGRAM_API } from './telegram-api'
import { TelegramConfig } from './telegram.config'
import { UnavailableTelegramApi } from './unavailable-telegram-api'
import type { TelegramApi } from './telegram-api'

const PRODUCTION = 'production'

/**
 * Транспорт Telegram — окремо від решти бота, і це не дрібниця структури.
 *
 * `TelegramModule` (прив'язка, вебхук, інлайн-кнопки) залежить від `LoansModule`,
 * бо §7.4 вимагає, щоб кнопка йшла крізь **той самий** `LoanService`. А
 * `NotificationsModule`, від якого залежить `LoansModule`, потребує транспорту,
 * щоб надсилати. Тримати все в одному модулі означало б цикл
 * Notifications → Telegram → Loans → Notifications. Транспорт же не знає ні про
 * лоани, ні про сповіщення — і винесений сюди саме тому.
 *
 * `@Global` із тієї ж причини, що й у `EmailModule`: це інфраструктура, а не домен.
 */
@Global()
@Module({
  providers: [
    TelegramConfig,
    HttpTelegramApi,
    FakeTelegramApi,
    UnavailableTelegramApi,
    {
      provide: TELEGRAM_API,
      /**
       * Три випадки, а не два — але сам транспорт лише ОБСЛУГОВУЄ канал,
       * який може існувати чи ні; чи канал узагалі активний, вирішує
       * `TelegramConfig.configured`, окремо від того, який об'єкт тут
       * повернеться.
       *
       * Токен є → справжній транспорт, незалежно від середовища: розробник із
       * власним ботом має бачити справжні повідомлення.
       *
       * Токена немає, і це **не** production → `FakeTelegramApi`. Свіжий
       * клон лишається проходимим, а CI не ходить у мережу (§11). Але канал
       * TELEGRAM у цьому випадку не «працює через фейк» — він так само
       * НЕАКТИВНИЙ, як і в production: `channelsFor()` дивиться на те саме
       * `configured` і без токена жодного разу не створює TELEGRAM-доставку,
       * а `POST /me/telegram/link` так само відмовляє 503 незалежно від
       * середовища. Фейк існує не для того, щоб канал "працював", а щоб
       * контейнер зібрався без спеціального випадку на dev/тести — і щоб
       * було на чому перевірити сам транспорт (`fake.outbox`) у тестах, які
       * викликають його напряму, в обхід `channelsFor`.
       *
       * Токена немає, і це production → `UnavailableTelegramApi`. Фейк тут
       * заборонений: він повертає успіх, доставка стала б `SENT`, і мовчазно
       * зламаний канал виглядав би як робочий. Падати на старті теж не можна —
       * Telegram опційний за §7.2, — тому канал існує, але кожна спроба ним
       * скористатися дає явну помилку.
       */
      useFactory: (
        config: TelegramConfig,
        env: ConfigService,
        http: HttpTelegramApi,
        fake: FakeTelegramApi,
        unavailable: UnavailableTelegramApi,
      ) => {
        const logger = new Logger('TelegramApiModule')

        if (config.configured) return http

        const production = (env.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === PRODUCTION
        const api: TelegramApi = production ? unavailable : fake

        logger.warn(
          production
            ? 'TELEGRAM_BOT_TOKEN не задано — канал TELEGRAM недоступний. ' +
                'Доставки в нього не створюються; це не тиха відмова, а явна.'
            : 'TELEGRAM_BOT_TOKEN не задано — канал TELEGRAM неактивний (фейковий ' +
                'транспорт піднято лише для контейнера й тестів): channelsFor() не ' +
                'створює для нього доставок, а прив’язка (POST /me/telegram/link) ' +
                'відмовляє 503 так само, як і в production.',
        )

        return api
      },
      inject: [
        TelegramConfig,
        ConfigService,
        HttpTelegramApi,
        FakeTelegramApi,
        UnavailableTelegramApi,
      ],
    },
  ],
  exports: [TELEGRAM_API, TelegramConfig, FakeTelegramApi],
})
export class TelegramApiModule {}
