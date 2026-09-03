import { readAddBookEntryMode } from './add-book-entry-mode'

describe('readAddBookEntryMode', () => {
  it.each([
    [null, 'manual'],
    ['', 'manual'],
    ['other', 'manual'],
    ['manual', 'manual'],
    ['scan', 'scan'],
  ] as const)('maps %s to %s', (value, expected) => {
    expect(readAddBookEntryMode(value)).toBe(expected)
  })
})
