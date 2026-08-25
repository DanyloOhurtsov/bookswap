'use client'

import { useEffect, useRef, useState } from 'react'
import {
  wishlistResponseSchema,
  type WishlistItem,
  type WishlistResponse,
  type Work,
  type WorkAuthor,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from './api'
import { displayDecision, type ResourceState } from './resource-state'
import { useApiResource } from './use-resource'
import {
  applyOperations,
  beginOperation,
  isInWishlist,
  optimisticWishlistItem,
  reconcileOperations,
  withCommittedOperation,
  withRolledBackOperation,
  type WishlistOperationIntent,
  type WishlistOperations,
} from './wishlist'

export interface WishlistController {
  /** Сирий стан GET-запиту — для повноекранного «Завантажую…»/помилки, поки жодних даних ще не було. */
  state: ResourceState<WishlistResponse>
  /** `undefined` лише поки не приїхала жодна успішна відповідь. */
  items: WishlistItem[] | undefined
  refreshing: boolean
  backgroundErrorMessage: string | undefined
  actionError: unknown
  /** `true` лише поки летить ВЛАСНИЙ HTTP цього workId — не для `committed`, що чекає лише підтвердження. */
  isPending: (workId: string) => boolean
  isMember: (workId: string) => boolean
  add: (work: Work, authors: WorkAuthor[]) => Promise<void>
  remove: (workId: string) => Promise<void>
}

/**
 * §6.5 і §8, підетап 7f.
 *
 * Один хук на дві сторінки — список вішлиста (де рядок зникає) і кнопку на
 * творі (де вона перемикається) — бо обидві мають той самий обов'язок:
 * показати зміну одразу, не чекаючи відповіді сервера, і відкотити її, якщо
 * запит не вдався. Друга копія цієї логіки одного дня розійшлася б із першою.
 *
 * Видима картинка рахується поверх останньої відповіді сервера тим самим
 * прийомом `lastData`/`displayDecision`, що й у налаштуваннях сповіщень:
 * `state.status` стає `loading` на КОЖЕН фоновий `reload()`, а список має
 * лишатися на екрані, поки летить свіжіша версія.
 *
 * Оптимістичний шар над цим — журнал операцій за workId (`wishlist.ts`), а
 * НЕ єдиний `overlay: WishlistItem[]` зі знімком «до»: два паралельні
 * `remove` над різними творами не повинні ділити один спільний снапшот для
 * відкату (інакше провал одного воскрешає вже підтверджений успіх іншого).
 */
export function useWishlist(): WishlistController {
  const { state, reload } = useApiResource('/me/wishlist', wishlistResponseSchema)
  const [lastData, setLastData] = useState<WishlistResponse>()

  /**
   * `operationsRef` — синхронна істина ДЛЯ ПОДІЙНИХ ОБРОБНИКІВ (`mutate`
   * нижче): guard проти дубльованого HTTP на подвійний клік мусить побачити
   * щойно розпочату операцію НЕГАЙНО, в той самий тік, до будь-якого
   * ре-рендеру — інакше другий виклик `add()`/`remove()` для того самого
   * workId, зроблений до того, як React встиг перемалювати кнопку
   * `disabled`, бачив би ще порожню мапу й теж стартував би HTTP.
   *
   * Читати чи писати `ref.current` ПІД ЧАС РЕНДЕРУ заборонено
   * (`react-hooks/refs`): рендер нижче звіряється з React-станом
   * (`operations`), а ref синхронізується з ним окремим ефектом ПІСЛЯ
   * коміту — до того, як користувач фізично встигне натиснути кнопку знову.
   */
  const operationsRef = useRef<WishlistOperations>(new Map())
  const [operations, setOperations] = useState<WishlistOperations>(() => new Map())

  useEffect(() => {
    operationsRef.current = operations
  }, [operations])

  /**
   * Reconciliation, щойно приходить свіжіший знімок сервера — не в
   * `useEffect`: `react-hooks/set-state-in-effect` навмисно забороняє
   * `setState` усередині ефекту, і ховати сеттер за проміжним helper'ом —
   * лише обійти правило, не усунути причину. Той самий приймальний трюк, що
   * й нижче для `lastData` (і в `use-resource.ts` для `tracked`/generation):
   * коригування стану ПІД ЧАС рендеру, під охороною «вхід справді змінився».
   * `state.data` тут завжди свіжий (сам хук уже пере-рендерився), тож умова
   * `state.data !== lastData` ловить точно один момент — новий `ready`
   * знімок, що ще не був звірений, — і більше НІКОЛИ не спрацьовує для тієї
   * самої відповіді: наступний рендер бачить `lastData === state.data` й
   * пропускає обидва `setState`.
   *
   * Звіряється з `operations` (React-стан), а НЕ з `operationsRef` — читати
   * ref під час рендеру так само заборонено, як і писати. `operations`
   * коректний тут: до нього завжди приходять або з попереднього коміту, або
   * із щойно застосованої зміни в тому самому рендері (React переганяє
   * функцію компонента заново на кожен `setState`, викликаний під час
   * рендеру, перш ніж комітити).
   *
   * Reconciliation чіпає лише `committed` (`reconcileOperations`), тож
   * старий/фоновий GET, що застав `pending` операцію, проходить повз —
   * жодного зайвого рендер-циклу це не створює: `setOperations` не
   * викликається взагалі, якщо `reconcileOperations` повернула той самий
   * `Map`.
   */
  if (state.status === 'ready' && state.data !== lastData) {
    setLastData(state.data)

    const reconciled = reconcileOperations(operations, state.data.items)

    if (reconciled !== operations) setOperations(reconciled)
  }

  const { data, refreshing, backgroundErrorMessage } = displayDecision(state, lastData)

  const [actionError, setActionError] = useState<unknown>()

  /**
   * Розмонтування під час `await request()`/`await reload()` не повинно
   * писати в стан зниклого компонента. `reload()` сам по собі безпечний
   * (`useApiResource` резолвить його на розмонтуванні, не лишаючи висячого
   * проміса); цей прапорець захищає саме нашу пару `commit/rollback`.
   */
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  function applyOperationsChange(next: WishlistOperations): void {
    if (next === operationsRef.current) return

    operationsRef.current = next
    setOperations(next)
  }

  const items = data === undefined ? undefined : applyOperations(data.items, operations)

  /**
   * Спільний хід для `add`/`remove`. `beginOperation` (`wishlist.ts`) — і
   * guard від дубльованого запиту (свій-таки чи inverse), і момент, коли
   * зміна стає видимою одразу, до відповіді сервера; він же відмовляє
   * дублю тієї самої дії, коли попередня вже `committed`.
   *
   * `reload()` після успіху НІКОЛИ не потрапляє в `catch`: у нього немає
   * "провалу" з погляду цього промиса (`useApiResource` резолвить його і
   * після невдалого GET) — тому фоновий провал підтвердження не показується
   * як провал mutation. Операція лишається `committed` і накладеною на
   * список; `backgroundErrorMessage` вище вже підхоплює `state.status ===
   * 'error'` сам, без додаткової участі цієї функції, а зняти операцію —
   * робота reconciliation вище на наступному вдалому GET, байдуже, який саме
   * виклик `reload()` його приніс.
   *
   * Overlapping mutation promises для ОДНОГО workId структурно неможливі:
   * `beginOperation` не пускає нову, поки стара `pending`, а перехід
   * `pending` → `committed`/rollback стається синхронно, одразу як власний
   * `request()` встановився, — до того, як `mutate()` взагалі дістається до
   * `await reload()`. Тому «стара generation комітить нову операцію» тут
   * неможливо в принципі: другий `mutate()` для того самого workId просто не
   * стартує, поки перший не звільнив запис. Захист від застарілих GET —
   * окремий, він живе в `useApiResource` (лічильник generation на кожен
   * `reload()`) і в тому, що reconciliation чіпає лише `committed`.
   */
  async function mutate(
    workId: string,
    intent: WishlistOperationIntent,
    request: () => Promise<void>,
  ): Promise<void> {
    if (data === undefined) return

    const attempt = beginOperation(operationsRef.current, workId, intent)

    if (!attempt.started) return

    applyOperationsChange(attempt.operations)
    setActionError(undefined)

    try {
      await request()
      if (!mountedRef.current) return

      // Замінює тимчасовий пункт справжнім (реальний `id`, `createdAt` із
      // сервера) і дає reconciliation свіжий знімок, за яким цю операцію
      // прибрати.
      applyOperationsChange(withCommittedOperation(operationsRef.current, workId))
      await reload()
    } catch (error) {
      if (!mountedRef.current) return

      // Не звичайне видалення: якщо ця mutation сама була inverse-дією над
      // committed-операцією, що вже пройшла, провал повертає ЇЇ, а не оголює
      // запис (`withRolledBackOperation`, `wishlist.ts`).
      applyOperationsChange(withRolledBackOperation(operationsRef.current, workId))
      setActionError(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    }
  }

  function add(work: Work, authors: WorkAuthor[]): Promise<void> {
    return mutate(work.id, { kind: 'add', item: optimisticWishlistItem(work, authors) }, () =>
      apiRequest('/me/wishlist', { method: 'POST', body: { workId: work.id } }),
    )
  }

  function remove(workId: string): Promise<void> {
    return mutate(workId, { kind: 'remove' }, () =>
      apiRequest(`/me/wishlist/${encodeURIComponent(workId)}`, { method: 'DELETE' }),
    )
  }

  return {
    state,
    items,
    refreshing,
    backgroundErrorMessage,
    actionError,
    isPending: (workId) => operations.get(workId)?.status === 'pending',
    isMember: (workId) => items !== undefined && isInWishlist(items, workId),
    add,
    remove,
  }
}
