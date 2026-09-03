import { z } from 'zod'

const addBookEntryModeSchema = z.enum(['manual', 'scan'])

export type AddBookEntryMode = z.infer<typeof addBookEntryModeSchema>

export function readAddBookEntryMode(value: string | null): AddBookEntryMode {
  return addBookEntryModeSchema.catch('manual').parse(value)
}
