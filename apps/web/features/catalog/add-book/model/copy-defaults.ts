import type { Condition, Visibility } from '@bookswap/shared'

export type CopyDefaults = {
  condition: Condition
  visibility: Visibility
}

export const DEFAULT_COPY_DEFAULTS: CopyDefaults = {
  condition: 'GOOD',
  visibility: 'FRIENDS',
}
