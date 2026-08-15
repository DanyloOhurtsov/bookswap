import Link from 'next/link'
import { HealthStatus } from './health-status'

/**
 * Статична сторінка: жодного звернення до API під час складання чи пререндеру.
 * Увесь мережевий обмін живе в клієнтському `HealthStatus`.
 */
export default function HomePage() {
  return (
    <main className="page">
      <h1>BookSwap</h1>
      <p className="lede">
        Сервіс обміну фізичними книжками. Готові акаунт і профіль; каталог, дружба й позичання
        зʼявляться наступними етапами.
      </p>

      <nav className="actions" aria-label="Основні дії">
        <Link href="/register">Створити акаунт</Link>
        <Link href="/login">Увійти</Link>
        <Link href="/profile">Профіль</Link>
      </nav>

      <HealthStatus />
    </main>
  )
}
