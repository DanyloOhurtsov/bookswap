import type { CookieOptions, Response } from 'express'
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './auth.constants'

/**
 * §6.1: session cookie з `httpOnly` і `SameSite=Lax`.
 *
 * - `httpOnly` — токен недосяжний для `document.cookie`, тож XSS не виносить сесію;
 * - `sameSite: 'lax'` — кукі не їде з чужого сайту POST-запитом, це базовий захист
 *   від CSRF. Достатньо саме тому, що фронт і бек за одним доменом через Caddy
 *   (§13.2): у dev localhost:3000 → localhost:3001 теж same-site, порт на це не впливає;
 * - `secure` — лише у проді: у dev усе по http://localhost, і з `Secure` кукі
 *   просто не встановилася б;
 * - `path: '/'` — інакше кукі не поїде на `/api/v1/...` з іншого шляху фронту.
 */
function cookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  }
}

export function setSessionCookie(response: Response, token: string, isProduction: boolean): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieOptions(isProduction),
    maxAge: SESSION_TTL_MS,
  })
}

/**
 * Атрибути мусять збігатися з тими, якими кукі ставилася, інакше браузер вважає
 * це іншою кукі й лишає стару на місці.
 */
export function clearSessionCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(SESSION_COOKIE_NAME, cookieOptions(isProduction))
}
