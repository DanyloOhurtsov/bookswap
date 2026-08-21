import type { ExecutionContext } from '@nestjs/common'

/**
 * `@Throttle` фіксує своє значення в момент декорування контролера — а це
 * відбувається до того, як `ConfigModule` встигає завантажити кореневий `.env`:
 * `app.module.ts` підвантажує (через `import`) контролери, зокрема
 * `CatalogController`, раніше, ніж викликає `ConfigModule.forRoot()`. Пряме
 * читання `process.env` тут повернуло б undefined навіть за наявного `.env`.
 *
 * Функція замість числа читається лінькво — `@nestjs/throttler` викликає її
 * при кожному запиті (`Resolvable<number>`), тобто вже після того, як
 * `ConfigModule` гарантовано завантажив і провалідував оточення.
 */
function fromEnv(key: string, fallback: number): (context: ExecutionContext) => number {
  return () => {
    const raw = process.env[key]
    if (raw === undefined || raw.trim() === '') return fallback

    const parsed = Number(raw)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
  }
}

/**
 * §11, R2: ліміт на створення Work/Translation/Edition — антиспам спільного
 * каталогу. Сховище лічильника — в пам'яті процесу (див. README): не переживає
 * рестарт і не ділиться між інстансами.
 */
export const CATALOG_WRITE_RATE_LIMIT = fromEnv('CATALOG_WRITE_RATE_LIMIT', 30)
export const CATALOG_WRITE_RATE_WINDOW_MS = fromEnv('CATALOG_WRITE_RATE_WINDOW_MS', 60 * 60_000)
