'use client'

import { useState } from 'react'
import { useNotifications } from '@/app/lib/use-notifications'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { NotificationItem } from '@/components/Notification/NotificationItem'
import { SegmentedControl, type SegmentedOption } from '@/components/SegmentedControl'
import { Button } from '@/components/ui/button'
import { FormStatus } from '@/components/Form/FormStatus'
import { Shell } from '@/components/Shell'
import { EmptyState, LoadingState } from '@/components/PageState'

type NotificationView = 'all' | 'unread'

const NotificationList = () => {
  const [view, setView] = useState<NotificationView>('all')
  const [failure, setFailure] = useState<unknown>()
  const [busyKey, setBusyKey] = useState<string>()

  const { state, reload } = useNotifications(view === 'unread')

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setFailure(undefined)
    setBusyKey(key)

    try {
      await action()
      await reload()
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setBusyKey(undefined)
    }
  }

  const markRead = (id: string): Promise<void> =>
    run(`read:${id}`, async () => {
      await apiRequest(`/me/notifications/${id}/read`, { method: 'PATCH' })
    })

  const readAll = (): Promise<void> =>
    run('read-all', async () => {
      await apiRequest('/me/notifications/read-all', { method: 'POST' })
    })

  const unreadCount = state.status === 'ready' ? state.data.unreadCount : 0
  const viewOptions: readonly SegmentedOption<NotificationView>[] = [
    { value: 'all', label: 'Усі' },
    {
      value: 'unread',
      label: (
        <span>
          Непрочитані
          {unreadCount > 0 && (
            <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[0.7rem] leading-none text-background">
              {unreadCount}
            </span>
          )}
        </span>
      ),
    },
  ]

  return (
    <Shell title="Сповіщення" description="Перегляньте свої сповіщення про події.">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Вигляд сповіщень"
          value={view}
          options={viewOptions}
          onValueChange={setView}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busyKey !== undefined || unreadCount === 0}
          onClick={() => void readAll()}
        >
          {busyKey === 'read-all' ? 'Позначаю…' : 'Прочитати всі'}
        </Button>
      </div>

      <FormStatus error={failure} />

      {state.status === 'loading' && <LoadingState>Завантажую сповіщення…</LoadingState>}
      {state.status === 'error' && <FormStatus error={new Error(state.message)} />}

      {state.status === 'ready' && state.data.notifications.length === 0 && (
        <EmptyState title={view === 'unread' ? 'Усе прочитано' : 'Сповіщень поки немає'}>
          {view === 'unread'
            ? 'Нові сповіщення зʼявляться тут.'
            : 'Ми покажемо тут нові події та оновлення позичань.'}
        </EmptyState>
      )}

      {state.status === 'ready' && state.data.notifications.length > 0 && (
        <ul className="people">
          {state.data.notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              busyKey={busyKey}
              onRead={() => void markRead(notification.id)}
            />
          ))}
        </ul>
      )}
    </Shell>
  )
}

export { NotificationList }
