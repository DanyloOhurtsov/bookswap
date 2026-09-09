import { describeA } from '@/eslint-fixtures/cycle-alias/module-a'

export function describeB(): string {
  return 'b'
}

export function describeBWithA(): string {
  return describeA()
}
