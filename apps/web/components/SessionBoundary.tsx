'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import type { Me } from '@bookswap/shared'
import { useSession } from '@/app/lib/use-session'
import { assertNever } from '@/app/lib/assert-never'
import { Shell, type ShellProps, FormStatus } from '@/components/index'

export interface AuthenticatedSession {
  user: Me
  reload: () => void
  setUser: (user: Me) => void
}

type SessionContent = ReactNode | ((session: AuthenticatedSession) => ReactNode)

type SessionBoundaryProps = Omit<ShellProps, 'children'> & {
  children: SessionContent
  loadingMessage?: string
}

/**
 * Shared boundary for pages that require an authenticated session.
 *
 * The boundary owns session loading, failure, guest redirect and exhaustive
 * state handling. Authenticated content stays in a child component, so hooks
 * inside that component are mounted only after authentication succeeds.
 */
function SessionBoundary({
  children,
  loadingMessage = 'Перевіряю сесію…',
  ...shellProps
}: SessionBoundaryProps) {
  const router = useRouter()
  const session = useSession()

  useEffect(() => {
    switch (session.state.status) {
      case 'guest':
        router.replace('/login')
        break
      case 'loading':
      case 'authenticated':
      case 'error':
        break
      default:
        assertNever(session.state)
    }
  }, [session.state, router])

  switch (session.state.status) {
    case 'loading':
      return (
        <Shell {...shellProps}>
          <p className="status status--pending" aria-label="Перевіряю сесію">
            {loadingMessage}
          </p>
        </Shell>
      )
    case 'error':
      return (
        <Shell {...shellProps}>
          <FormStatus error={new Error(session.state.message)} />
          <p className="form__aside">
            <button type="button" onClick={session.reload}>
              Спробувати ще раз
            </button>
          </p>
        </Shell>
      )
    case 'guest':
      return (
        <Shell {...shellProps}>
          <p className="status status--pending">
            Потрібен вхід. Переадресовую… <Link href="/login">Увійти зараз</Link>
          </p>
        </Shell>
      )
    case 'authenticated':
      return typeof children === 'function'
        ? children({
            user: session.state.user,
            reload: session.reload,
            setUser: session.setUser,
          })
        : children
    default:
      return assertNever(session.state)
  }
}

export { SessionBoundary }
