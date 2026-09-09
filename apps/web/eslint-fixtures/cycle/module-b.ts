import { describeA } from './module-a'

export function describeB(): string {
  return 'b'
}

export function describeBWithA(): string {
  return describeA()
}
