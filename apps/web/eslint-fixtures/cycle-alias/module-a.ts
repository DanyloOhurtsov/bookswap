import { describeB } from '@/eslint-fixtures/cycle-alias/module-b'

export function describeA(): string {
  return 'a'
}

export function describeAWithB(): string {
  return describeB()
}
