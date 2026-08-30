import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { FriendsPageContent, SessionBoundary, Shell } from '@/components/index'

export default function FriendsPage() {
  const cta = (
    <Link className={buttonVariants({ variant: 'outline' })} href="/friends#friend-search-title">
      Додати друга
    </Link>
  )

  return (
    <SessionBoundary
      title="Друзі"
      description="Переглядайте бібліотеки друзів і керуйте запитами без зайвого шуму."
      cta={cta}
    >
      <Shell
        title="Друзі"
        description="Переглядайте бібліотеки друзів і керуйте запитами без зайвого шуму."
        cta={cta}
      >
        <FriendsPageContent />
      </Shell>
    </SessionBoundary>
  )
}
