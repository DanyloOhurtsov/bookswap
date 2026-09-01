/** @jest-environment jsdom */

import { applyTheme, isTheme, resolveTheme } from './theme'

describe('theme', () => {
  it('accepts only supported theme values', () => {
    expect(isTheme('light')).toBe(true)
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('system')).toBe(true)
    expect(isTheme('sepia')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })

  it('resolves the system theme from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('applies the resolved class, theme metadata, and color scheme', () => {
    const root = document.documentElement

    expect(applyTheme(root, 'system', true)).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
    expect(root.dataset.theme).toBe('system')
    expect(root.style.colorScheme).toBe('dark')

    applyTheme(root, 'light', true)
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })
})
