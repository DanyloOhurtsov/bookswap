'use client'

import {
  notificationPreferencesResponseSchema,
  type NotificationPreferencesResponse,
} from '@bookswap/shared'
import { useApiResource, type Resource } from './use-resource'

export type NotificationPreferencesResource = Resource<NotificationPreferencesResponse>

/** §8: `GET /me/notification-preferences` — матриця §7.6 разом зі станом каналів. */
export function useNotificationPreferences(): NotificationPreferencesResource {
  return useApiResource('/me/notification-preferences', notificationPreferencesResponseSchema)
}
