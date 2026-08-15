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
        Сервіс обміну фізичними книжками. Зараз готовий лише каркас монорепо — доменна модель
        зʼявиться наступним етапом.
      </p>
      <HealthStatus />
    </main>
  )
}
