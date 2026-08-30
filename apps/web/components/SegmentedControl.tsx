'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/index'

interface SegmentedOption<Value extends string> {
  value: Value
  label: ReactNode
  disabled?: boolean
}

interface SegmentedControlProps<Value extends string> {
  value: Value
  options: readonly SegmentedOption<Value>[]
  label: string
  onValueChange: (value: Value) => void
  className?: string
}

/**
 * Compact single-choice control for local page views and filters.
 * `aria-pressed` keeps it understandable as a group of toggle buttons without
 * pretending that client-side filtered panels are document navigation tabs.
 */
function SegmentedControl<Value extends string>({
  value,
  options,
  label,
  onValueChange,
  className,
}: SegmentedControlProps<Value>) {
  return (
    <div
      className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1', className)}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value

        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            className={cn(
              'h-8 px-3 text-muted-foreground',
              selected && 'bg-background text-foreground shadow-sm hover:bg-background',
            )}
            disabled={option.disabled}
            aria-pressed={selected}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

export { SegmentedControl, type SegmentedOption }
