import { describeB } from './module-b'

export function describeA(): string {
  return 'a'
}

export function describeAWithB(): string {
  return describeB()
}
