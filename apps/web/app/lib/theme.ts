export const THEME_STORAGE_KEY = 'bookswap-theme'

export const THEMES = ['light', 'dark', 'system'] as const

export type Theme = (typeof THEMES)[number]
export type ResolvedTheme = Exclude<Theme, 'system'>

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.includes(value as Theme)
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return theme
}

export function applyTheme(root: HTMLElement, theme: Theme, prefersDark: boolean): ResolvedTheme {
  const resolvedTheme = resolveTheme(theme, prefersDark)

  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.classList.toggle('light', resolvedTheme === 'light')
  root.dataset.theme = theme
  root.style.colorScheme = resolvedTheme

  return resolvedTheme
}

/**
 * Runs in the document head before React hydrates, preventing the saved dark
 * theme from briefly rendering as light.
 */
export const THEME_INITIALIZER_SCRIPT = `
  (() => {
    try {
      const storedTheme = localStorage.getItem('${THEME_STORAGE_KEY}');
      const theme = ['light', 'dark', 'system'].includes(storedTheme)
        ? storedTheme
        : 'system';
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolvedTheme = theme === 'system'
        ? (prefersDark ? 'dark' : 'light')
        : theme;
      const root = document.documentElement;

      root.classList.toggle('dark', resolvedTheme === 'dark');
      root.classList.toggle('light', resolvedTheme === 'light');
      root.dataset.theme = theme;
      root.style.colorScheme = resolvedTheme;
    } catch {
      document.documentElement.classList.add('light');
    }
  })();
`
