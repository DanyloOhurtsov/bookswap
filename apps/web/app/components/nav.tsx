'use client'

import Link from 'next/link'
import { useSession } from '../lib/use-session'

const NavBar = () => {
  const { state } = useSession()

  return (
    <nav
      className="sticky top-0 z-50 flex flex-wrap items-center gap-4 border-b border-(--line) bg-(--bg) px-6 py-3"
      aria-label="Основні дії"
    >
      {state.status === 'authenticated' ? (
        <>
          <Link href="/profile">Профіль</Link>
          <Link href="/friends">Друзі</Link>
          <Link href="/catalog">Каталог</Link>
          <Link href="/library">Моя бібліотека</Link>
          <Link href="/wishlist">Вішлист</Link>
          <Link href="/loans">Позичання</Link>
          <Link href="/history">Історія</Link>
          <Link href="/notifications">Сповіщення</Link>
          <Link href="/notifications/settings">Налаштування сповіщень</Link>
        </>
      ) : (
        <>
          <Link href="/register">Створити акаунт</Link>
          <Link href="/login">Увійти</Link>
        </>
      )}
    </nav>
  )
}

export default NavBar
