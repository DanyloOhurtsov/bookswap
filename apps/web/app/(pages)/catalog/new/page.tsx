import { Suspense } from 'react'
import { Shell } from '@/components/Shell'
import { SessionBoundary } from '@/components/SessionBoundary'
import { AddBookFlow } from '@/components/Catalog/AddBook/AddBookFlow'

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
