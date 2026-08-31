'use client'

import {
  copyHistoryResponseSchema,
  workHistoryResponseSchema,
  type CopyHistoryResponse,
  type WorkHistoryResponse,
} from '@bookswap/shared'
import { useApiResource, type Resource } from './use-resource'

/**
 * §6.6: в'ю історії, які читаються з клієнта, — примірника й твору. Власна
 * історія (`/me/history`) сюди більше не входить: її читає серверний рендер
 * своєї сторінки.
 *
 * Фронт нічого не приховує сам: рішення «з іменами чи без» ухвалює API за §9, і
 * коли імен бачити не належить, полів із ними у відповіді просто немає. Тому тут
 * лише завантаження — жодної фільтрації. Фільтрувати на клієнті означало б
 * завести другу реалізацію тієї самої матриці, яка одного дня розійдеться з
 * першою.
 */

/** §8: `GET /copies/:id/history` — усі лоани примірника в хронології. */
export function useCopyHistory(copyId: string): Resource<CopyHistoryResponse> {
  return useApiResource(`/copies/${encodeURIComponent(copyId)}/history`, copyHistoryResponseSchema)
}

/** §8: `GET /works/:id/history` — «хто з моїх це взагалі читав». */
export function useWorkHistory(workId: string): Resource<WorkHistoryResponse> {
  return useApiResource(`/works/${encodeURIComponent(workId)}/history`, workHistoryResponseSchema)
}
