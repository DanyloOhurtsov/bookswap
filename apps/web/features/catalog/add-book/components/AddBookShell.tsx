import type { ReactNode } from 'react'
import type { AddBookStep } from '../model/add-book-step'

type AddBookShellProps = {
  step: AddBookStep
  children: ReactNode
}

/**
 * The flow length depends on whether the catalog already contains the work or
 * edition, so a fixed "step X of N" indicator would be misleading.
 */
const STEP_TITLES: Readonly<Record<AddBookStep['kind'], string>> = {
  search: 'Пошук у каталозі',
  work: 'Твір',
  translation: 'Переклад',
  edition: 'Видання',
  copy: 'Ваш примірник',
  done: 'Готово',
}

export function AddBookShell({ step, children }: AddBookShellProps) {
  return (
    <main className="page">
      <h1>Додати книжку</h1>
      <p className="lede">{STEP_TITLES[step.kind]}</p>
      {children}
    </main>
  )
}
