import { testDatabaseUrl } from './test-database'

/**
 * Виконується до завантаження тестових модулів (`setupFiles`).
 *
 * `ConfigModule` читає кореневий `.env`, але dotenv не перетирає вже наявні
 * значення в `process.env` — тож підміна тут виграє, і e2e-застосунок піднімається
 * на тестовій базі, а не на dev'івській.
 *
 * Порядок важливий: `testDatabaseUrl()` проганяє fail-closed перевірку (`guard.ts`)
 * на НЕЗАЙМАНОМУ оточенні й запам'ятовує результат. Якби підміна сталася раніше,
 * перевірка «TEST_DATABASE_URL ≠ DATABASE_URL» побачила б збіг, який сама ж і
 * створила.
 */
const url = testDatabaseUrl()

process.env.DATABASE_URL = url
process.env.DIRECT_DATABASE_URL = url
