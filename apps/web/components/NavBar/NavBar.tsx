'use client'

import { useSession } from '@/app/lib/use-session'
import { NavContent } from '@/components/NavBar/NavBarContent'

export const NavBar = () => {
  const { state } = useSession()

  return (
    <div
      className="sticky top-0 z-50 flex items-center justify-center gap-4 border-b border-(--line) bg-(--bg) px-6 py-3"
      aria-label="Основні дії"
      aria-busy={state.status === 'loading'}
    >
      <NavContent state={state} />
    </div>
  )
}
