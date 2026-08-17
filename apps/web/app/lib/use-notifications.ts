'use client'

import { notificationListResponseSchema, type NotificationListResponse } from '@bookswap/shared'
import { useApiResource, type Resource } from './use-resource'

/**
 * §8: `GET /me/notifications?unread=true`.
 *
 * `unreadCount` приходить окремо від списку й **не** виводиться з його довжини:
 * лічильник має однаково працювати на обох вкладках, а на вкладці «усі» довжина
 * списку відповідала б на інше питання.
 */
export type NotificationsResource = Resource<NotificationListResponse>

export function useNotifications(unreadOnly: boolean): NotificationsResource {
  return useApiResource(
    `/me/notifications${unreadOnly ? '?unread=true' : ''}`,
    notificationListResponseSchema,
  )
}
