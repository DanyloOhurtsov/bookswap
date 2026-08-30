import Link from 'next/link'
import type { Me } from '@bookswap/shared'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/index'
import { NAVBAR_PROFILE_LINKS } from '@/constants/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)

  if (parts.length === 0) return '?'

  const first = Array.from(parts[0] ?? '')
  const last = Array.from(parts.at(-1) ?? '')
  const initials =
    parts.length === 1
      ? first.slice(0, 2).join('')
      : `${first[0] ?? ''}${last[0] ?? ''}`

  return initials.toLocaleUpperCase('uk-UA')
}

export const NavBarAvatar = ({ user }: { user: Me }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="unstyled"
            aria-label={`Відкрити меню профілю: ${user.displayName}`}
          >
            <Avatar size="lg">
              {user.avatarUrl !== null && (
                <AvatarImage src={user.avatarUrl} alt={user.displayName} />
              )}
              <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          {NAVBAR_PROFILE_LINKS.map((link) => (
            <DropdownMenuItem key={link.href} render={<Link href={link.href} />}>
              {link.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
