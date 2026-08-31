import { z } from 'zod'

const HISTORY_VIEW_VALUES = ['borrowed', 'lent'] as const

const historyViewSchema = z.enum(HISTORY_VIEW_VALUES)

type HistoryView = z.infer<typeof historyViewSchema>

const DEFAULT_HISTORY_VIEW: HistoryView = 'borrowed'

function parseHistoryView(value: unknown): HistoryView {
  const parsed = historyViewSchema.safeParse(value)

  return parsed.success ? parsed.data : DEFAULT_HISTORY_VIEW
}

export { historyViewSchema, parseHistoryView, type HistoryView }
