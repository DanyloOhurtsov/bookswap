import type { ReactNode } from 'react'
import { Inbox, LoaderCircle } from 'lucide-react'

interface LoadingStateProps {
  children?: ReactNode
  compact?: boolean
}

function LoadingState({ children = 'Завантажую…', compact = false }: LoadingStateProps) {
  return (
    <div
      className={
        compact
          ? 'flex items-center gap-2 text-sm text-muted-foreground'
          : 'flex min-h-28 items-center justify-center gap-3 rounded-xl border bg-muted/20 px-5 py-8 text-sm text-muted-foreground'
      }
      role="status"
      aria-live="polite"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

interface EmptyStateProps {
  title?: string
  children: ReactNode
  action?: ReactNode
  compact?: boolean
}

function EmptyState({ title, children, action, compact = false }: EmptyStateProps) {
  return (
    <div
      className={
        compact
          ? 'rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground'
          : 'flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/10 px-6 py-8 text-center'
      }
    >
      {!compact && <Inbox className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />}
      {title !== undefined && <p className="font-medium text-foreground">{title}</p>}
      <div
        className={
          title === undefined
            ? 'text-sm text-muted-foreground'
            : 'mt-1 text-sm text-muted-foreground'
        }
      >
        {children}
      </div>
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  )
}

export { EmptyState, LoadingState }
