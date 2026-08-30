import { Suspense } from 'react'
import { Shell, SessionBoundary, AddBookFlow } from '@/components/index'

export default function NewBookPage() {
  return (
    <Suspense
      fallback={
        <Shell title="Додати книжку">
          <p className="status status--pending">Читаю запит…</p>
        </Shell>
      }
    >
      <SessionBoundary title="Додати книжку">
        <AddBookFlow />
      </SessionBoundary>
    </Suspense>
  )
}
