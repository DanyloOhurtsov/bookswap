import Link from 'next/link'
import type { Me } from '@bookswap/shared'
import { type SessionState } from '@/app/lib/use-session'
import { NAVBAR_LINKS_AUTH, NAVBAR_LINKS_GUEST } from '@/constants/navigation'
import { NavBarAvatar, NavBarNotifications, NavBarLogo, ThemeSwitcher } from '@/components/index'

const NavContent = ({ state }: { state: SessionState }) => {
  switch (state.status) {
    case 'loading':
      return (
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
          <NavSkeleton />
          <ThemeSwitcher />
        </div>
      )

    case 'authenticated':
      return <AuthNav user={state.user} />

    case 'guest':
    case 'error':
      return <GuestNav />
  }
}

// AuthNav
const AuthNav = ({ user }: { user: Me }) => {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
      <NavBarLogo />
      <nav className="flex items-center gap-4">
        {NAVBAR_LINKS_AUTH.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <ThemeSwitcher />
        <NavBarNotifications />
        <NavBarAvatar user={user} />
      </div>
    </div>
  )
}

// GuestNav
const GuestNav = () => {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
      <NavBarLogo />
      <div className="flex items-center gap-2">
        <nav className="flex items-center gap-4">
          {NAVBAR_LINKS_GUEST.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <ThemeSwitcher />
      </div>
    </div>
  )
}

// NavSkeleton
const NavSkeleton = () => (
  <div className="flex items-center gap-4 animate-pulse" aria-hidden="true">
    <div className="h-5 w-16 rounded bg-(--line)" />
    <div className="h-5 w-20 rounded bg-(--line)" />
    <div className="h-5 w-24 rounded bg-(--line)" />
    <div className="h-5 w-20 rounded bg-(--line)" />
  </div>
)

export { NavContent }
