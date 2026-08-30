import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ShellProps {
  title: string
  description?: string
  children: ReactNode
  cta?: ReactNode
  size?: 'narrow' | 'default' | 'wide'
  className?: string
}

const WIDTHS: Readonly<Record<NonNullable<ShellProps['size']>, string>> = {
  narrow: 'max-w-xl',
  default: 'max-w-3xl',
  wide: 'max-w-6xl',
}

function Shell({ title, description, children, cta, size = 'default', className }: ShellProps) {
  return (
    <main className={cn('mx-auto w-full px-4 py-8 sm:px-6 sm:py-12', WIDTHS[size], className)}>
      <header className="mb-8 sm:mb-10">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {cta !== undefined && <div className="shrink-0">{cta}</div>}
        </div>
        {description !== undefined && (
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        )}
      </header>
      {children}
    </main>
  )
}

export { Shell }
