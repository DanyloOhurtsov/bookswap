'use client'

import { useSyncExternalStore } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { applyTheme, isTheme, THEME_STORAGE_KEY, type Theme } from '@/app/lib/theme'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const THEME_OPTIONS = [
  { value: 'light', label: 'Світла', icon: SunIcon },
  { value: 'dark', label: 'Темна', icon: MoonIcon },
  { value: 'system', label: 'Системна', icon: MonitorIcon },
] as const

const themeLabels: Record<Theme, string> = {
  light: 'Світла',
  dark: 'Темна',
  system: 'Системна',
}

const THEME_CHANGE_EVENT = 'bookswap-theme-change'

function applySelectedTheme(theme: Theme): void {
  applyTheme(
    document.documentElement,
    theme,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
}

function getThemeSnapshot(): Theme {
  const theme = document.documentElement.dataset.theme
  return isTheme(theme) ? theme : 'system'
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

  applySelectedTheme(getThemeSnapshot())

  const handleSystemThemeChange = () => {
    if (getThemeSnapshot() === 'system') {
      applySelectedTheme('system')
    }
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return

    const nextTheme = isTheme(event.newValue) ? event.newValue : 'system'
    applySelectedTheme(nextTheme)
    onStoreChange()
  }

  colorScheme.addEventListener('change', handleSystemThemeChange)
  window.addEventListener('storage', handleStorageChange)
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange)

  return () => {
    colorScheme.removeEventListener('change', handleSystemThemeChange)
    window.removeEventListener('storage', handleStorageChange)
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange)
  }
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore<Theme>(subscribeToTheme, getThemeSnapshot, () => 'system')

  const selectTheme = (value: string) => {
    if (!isTheme(value)) return

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      // Theme switching still works for the current page when storage is blocked.
    }

    applySelectedTheme(value)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  const SelectedIcon = THEME_OPTIONS.find((option) => option.value === theme)?.icon ?? MonitorIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Змінити тему. Поточна: ${themeLabels[theme].toLocaleLowerCase('uk-UA')}`}
            title={`Тема: ${themeLabels[theme]}`}
          >
            <SelectedIcon aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={theme} onValueChange={selectTheme}>
          <DropdownMenuLabel>Тема</DropdownMenuLabel>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
