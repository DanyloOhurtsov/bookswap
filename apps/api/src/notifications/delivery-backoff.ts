import {
  DELIVERY_BACKOFF_BASE_MS,
  DELIVERY_BACKOFF_MAX_MS,
  MAX_DELIVERY_ATTEMPTS,
} from './notifications.constants'

/**
 * §7.3, правило 2: «при помилці інкрементує `attempts` і відсуває `nextAttemptAt`
 * з експоненційною затримкою».
 *
 * Чиста функція, бо це єдина частина ретраїв, яку можна перевірити, не піднімаючи
 * ні бази, ні каналів, — і саме в ній легко помилитися на одиницю. `attempts` тут
 * — кількість спроб, які **вже** відбулися (лічильник після інкремента), тож
 * перша невдача чекає рівно базу.
 */
export function backoffDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)

  return Math.min(DELIVERY_BACKOFF_BASE_MS * 2 ** exponent, DELIVERY_BACKOFF_MAX_MS)
}

/**
 * §7.3, правило 2: «Після 5 спроб — `FAILED`».
 *
 * Виділено окремо від `backoffDelayMs`, бо це різні питання: «коли пробувати
 * знову» і «чи пробувати взагалі». Злиті в одну функцію (напр. «повернути `null`
 * замість затримки»), вони дали б виклик, у якому `null` мовчки означає термінальний
 * стан — і перший же `?? DEFAULT` у викликача воскресив би мертвий рядок.
 */
export function isTerminalFailure(attempts: number): boolean {
  return attempts >= MAX_DELIVERY_ATTEMPTS
}

/** Момент наступної спроби після невдалої. */
export function nextAttemptAfterFailure(now: Date, attempts: number): Date {
  return new Date(now.getTime() + backoffDelayMs(attempts))
}
