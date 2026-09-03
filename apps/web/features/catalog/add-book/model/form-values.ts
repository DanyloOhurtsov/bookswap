export function nullableText(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value
}

export function nullableNumber(value: unknown): unknown {
  return value === '' || value === null || value === undefined ? null : Number(value)
}
