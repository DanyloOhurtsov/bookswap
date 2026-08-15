import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { assertSafeTestDatabase } from './guard'
import { maintenanceUrl } from './test-database'

/**
 * Готує тестову базу перед прогоном: дропає стару й накатує міграції на чисту.
 *
 * Це не лише зручність ізоляції — так кожен `pnpm test:db` перевіряє критерій
 * «чиста PostgreSQL приймає всі міграції з нуля», включно з порядком
 * `CREATE EXTENSION` перед GIN-індексами (§4.9). На старій локальній базі така
 * помилка непомітна: розширення в ній уже є.
 */
export default async function globalSetup(): Promise<void> {
  // Fail-closed перевірка — ПЕРШИМ рядком, до створення Client і до будь-якого
  // підключення. Дропати можна лише локальну базу з суфіксом _test, і лише таку,
  // що не збігається з робочою (див. guard.ts).
  const { url, database } = assertSafeTestDatabase(process.env)

  const admin = new Client({ connectionString: maintenanceUrl() })

  await admin.connect()

  try {
    // `database` пройшов whitelist ^[A-Za-z0-9_]+_test$, тож у ньому фізично не
    // може бути лапки, пробілу чи крапки з комою — межі ідентифікатора не зламати.
    // Параметризувати DDL не можна: PostgreSQL не приймає плейсхолдери для імен
    // об'єктів, тож інтерполяція тут єдиний спосіб, і безпечним його робить guard.
    //
    // FORCE відчіпляє чужі сесії: без нього дроп падає, якщо лишилося відкрите
    // підключення з попереднього прогону.
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.query(`CREATE DATABASE "${database}"`)
  } finally {
    await admin.end()
  }

  // Prisma CLI запускається через node з явним шляхом до бін-файлу: `pnpm exec`
  // тягне за собою різницю між .cmd і shell-скриптом на Windows та Linux.
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DIRECT_DATABASE_URL: url, DATABASE_URL: url },
    stdio: 'inherit',
  })
}
