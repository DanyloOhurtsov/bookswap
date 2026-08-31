import { myHistoryResponseSchema } from '@bookswap/shared'
import { Shell } from '@/components/Shell'
import {
  HISTORY_SHELL,
  HistoryList,
  HistoryViewNav,
  parseHistoryView,
  type HistoryView,
} from '@/features/history'
import { fetchAuthenticated } from '@/lib/api.server'

interface HistoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const EMPTY_MESSAGES: Readonly<Record<HistoryView, string>> = {
  borrowed: 'Ви ще нічого не брали.',
  lent: 'У вас ще нічого не брали.',
}

/**
 * No loading.tsx: auth and data share one request, so streaming a shell before
 * its 401 could turn the early HTTP redirect into a client redirect inside 200.
 */
export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { view: rawView } = await searchParams
  const view = parseHistoryView(rawView)
  const history = await fetchAuthenticated('/me/history', myHistoryResponseSchema)

  return (
    <Shell {...HISTORY_SHELL}>
      <HistoryViewNav view={view} />
      <HistoryList items={history[view]} emptyMessage={EMPTY_MESSAGES[view]} />
    </Shell>
  )
}
