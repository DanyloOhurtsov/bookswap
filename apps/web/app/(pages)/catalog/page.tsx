import { Suspense } from 'react'
import { SessionBoundary, Shell, CatalogSearch } from '@/components/index'

/**
 * §6.3, кроки 1–2: людина вводить назву або ISBN і бачить «Можливо, це одна з
 * цих?» — разом із виданнями, бо саме на них вона впізнає своє.
 *
 * Це найважливіший екран сервісу: він прибирає більшість дублікатів ще до їхньої
 * появи. Тому кнопка «Створити новий твір» стоїть ПІД результатами, а не поруч
 * із пошуком — спершу подивись, чи його вже завели.
 */
export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <Shell title="Каталог">
          <p className="status status--pending">Читаю запит…</p>
        </Shell>
      }
    >
      <SessionBoundary title="Каталог">
        <CatalogSearch />
      </SessionBoundary>
    </Suspense>
  )
}
