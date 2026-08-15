/**
 * Порт для надсилання листів (§7.2).
 *
 * Інтерфейс з'являється зараз, бо етап акаунтів уже мусить щось надсилати —
 * підтвердження пошти й скидання пароля. Реалізація поки одна, dev'ова; Resend
 * або Postmark стають ще однією реалізацією цього самого порту на етапі
 * сповіщень, без правок у сервісі акаунтів.
 *
 * Черги, ретраїв і `NotificationDelivery` тут навмисно немає — це §7.3 і етап 3.
 */
export interface EmailMessage {
  to: string
  subject: string
  /** Текстове тіло. HTML з'явиться разом із реальним провайдером. */
  body: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

/** DI-токен: інтерфейс TypeScript не існує в рантаймі, тож інжектимо за рядком. */
export const EMAIL_SENDER = 'EMAIL_SENDER'
