import { Injectable, Logger } from '@nestjs/common'
import type {
  TelegramApi,
  TelegramCallbackAnswer,
  TelegramMessageDraft,
  TelegramMessageEdit,
} from './telegram-api'

/** Скільки останніх повідомлень тримати. Те саме обмеження, що в `DevEmailSender`. */
const OUTBOX_LIMIT = 50

/**
 * Реалізація без мережі — **лише** для локальної розробки й тестів (§11: «не
 * виконуй зовнішні HTTP-виклики в тестах»).
 *
 * Підіймається тоді, коли бота не налаштовано, тобто на свіжому клоні
 * репозиторію. Але це НЕ означає, що канал `TELEGRAM` у цьому стані «працює»:
 * `channelsFor()` дивиться на `TelegramConfig.configured`, а не на те, який
 * транспорт зараз підняли, і без токена не створює жодної TELEGRAM-доставки
 * — так само, як і в production. `POST /me/telegram/link` так само відмовляє
 * 503. Реальний потік сповіщень через цей клас без токена НІКОЛИ не йде; його
 * `outbox` заповнюється лише тоді, коли щось (як правило, тест) звертається
 * до `sendMessage()`/`answerCallbackQuery()`/`editMessageText()` НАПРЯМУ, в
 * обхід `channelsFor`. Причина, чому цей клас узагалі існує в такому стані, —
 * не «канал працює», а виключно щоб контейнер DI зібрався без спеціального
 * випадку на dev/тести, і щоб сам транспорт (не диспетчер) можна було
 * перевірити ізольовано.
 *
 * **У production не підіймається ніколи** — там її місце займає
 * `UnavailableTelegramApi`. Причина не в чистоті, а в тому, що фейк повертає
 * успіх: якби `channelsFor()` колись створив для нього доставку, вона стала б
 * `SENT`, хоча нікому нічого не надіслано. Черга §7.3 перестала б означати те,
 * що означає, і єдиний спосіб дізнатися про мовчазно зламаний канал — скарга
 * людини, яка не отримала запит на свою книжку.
 *
 * На відміну від попередньої версії, у лог не потрапляє **нічого з тіла**: ні
 * `chat_id`, ні текст, ні `callback_data`. Текст сповіщення — це чуже приватне
 * листування («Марта просить у вас «Шантарам»»), а `chat_id` — стабільний
 * ідентифікатор людини в Telegram. Лог від них не захищений, а розробнику, якому
 * треба побачити повідомлення, доступний `outbox` у пам'яті процесу.
 */
@Injectable()
export class FakeTelegramApi implements TelegramApi {
  private readonly logger = new Logger(FakeTelegramApi.name)
  private readonly messages: TelegramMessageDraft[] = []
  private readonly answers: TelegramCallbackAnswer[] = []
  private readonly edits: TelegramMessageEdit[] = []

  sendMessage(draft: TelegramMessageDraft): Promise<void> {
    push(this.messages, draft)

    // Лише факт і форма — жодного вмісту.
    this.logger.log(
      `Telegram (fake, нікуди не відправлено): повідомлення, кнопок ${String(draft.buttons.length)}`,
    )

    return Promise.resolve()
  }

  answerCallbackQuery(answer: TelegramCallbackAnswer): Promise<void> {
    push(this.answers, answer)

    return Promise.resolve()
  }

  editMessageText(edit: TelegramMessageEdit): Promise<void> {
    push(this.edits, edit)

    return Promise.resolve()
  }

  /** Копії, а не внутрішні масиви: викликач не має можливості їх правити. */
  get outbox(): readonly TelegramMessageDraft[] {
    return [...this.messages]
  }

  get answered(): readonly TelegramCallbackAnswer[] {
    return [...this.answers]
  }

  get edited(): readonly TelegramMessageEdit[] {
    return [...this.edits]
  }

  lastTo(chatId: string): TelegramMessageDraft | undefined {
    return [...this.messages].reverse().find((message) => message.chatId === chatId)
  }

  clear(): void {
    this.messages.length = 0
    this.answers.length = 0
    this.edits.length = 0
  }
}

function push<T>(target: T[], item: T): void {
  target.push(item)

  if (target.length > OUTBOX_LIMIT) target.shift()
}
