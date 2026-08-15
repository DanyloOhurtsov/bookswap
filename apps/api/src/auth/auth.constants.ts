/**
 * Терміни життя та параметри кукі (§6.1).
 *
 * Константами, а не змінними оточення: кожен новий env-ключ — це ще один спосіб
 * зламати прод одруківкою, а жодне з цих значень не мусить відрізнятися між
 * середовищами. `Secure` — єдиний виняток, він виводиться з NODE_ENV.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Місяць. Довше — незручно відкликати, коротше — люди логінитимуться щотижня. */
export const SESSION_TTL_MS = 30 * DAY

/** Доба: лист про підтвердження цілком може почекати до завтра. */
export const EMAIL_VERIFICATION_TTL_MS = DAY

/** Година: скидання пароля робиться тут і зараз, довге вікно лише збільшує ризик. */
export const PASSWORD_RESET_TTL_MS = HOUR

/** Як часто прибирати прострочені сесії й токени. */
export const CLEANUP_INTERVAL_MS = 15 * MINUTE

/**
 * Ім'я кукі. Префікс `__Host-` навмисно не використовується: він вимагає Secure,
 * а в dev фронт і API ходять по http://localhost.
 */
export const SESSION_COOKIE_NAME = 'bookswap_session'
