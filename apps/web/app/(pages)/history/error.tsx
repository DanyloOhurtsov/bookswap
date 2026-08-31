'use client'

import { FormStatus } from '@/components/Form/FormStatus'
import { Shell } from '@/components/Shell'
import { HISTORY_SHELL } from '@/features/history/index.client'

interface HistoryErrorProps {
  error: Error
  reset: () => void
}

/**
 * §3.5, стан «помилка».
 *
 * Клієнтський за вимогою Next: межа помилки мусить уміти перемонтувати гілку
 * (`reset`). Замінює той самий `FormStatus` + «Спробувати ще раз», що показував
 * клієнтський екран до перенесення фетчингу на сервер.
 */
export default function HistoryError({ error, reset }: HistoryErrorProps) {
  return (
    <Shell {...HISTORY_SHELL}>
      <FormStatus error={error} />
      <p className="form__aside">
        <button type="button" onClick={reset}>
          Спробувати ще раз
        </button>
      </p>
    </Shell>
  )
}
