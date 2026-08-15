'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { sessionResponseSchema } from '@bookswap/shared'
import { FormStatus } from '../components/form-status'
import { ApiRequestError, apiRequest, describeError } from '../lib/api'

type State =
  | { kind: 'ready' }
  | { kind: 'confirming' }
  | { kind: 'confirmed'; email: string }
  | { kind: 'failed'; error: unknown }

/**
 * Підтвердження запускає ЛЮДИНА кнопкою, а не `useEffect` при відкритті.
 *
 * Токен одноразовий, а GET-посилання з листа відкривають не лише люди:
 * поштові сканери безпеки, антивіруси й префетчери переходять за ним самі.
 * Автоматичний POST при монтуванні означав би, що токен гаситься ще до того,
 * як користувач побачить сторінку, — і він отримає «посилання вже використане»
 * на цілком свіжому листі.
 *
 * Друга причина дрібніша, але б'є одразу: у dev React монтує компонент двічі,
 * тож ефект відправив би два запити, і другий стабільно показував би помилку
 * поверх успішного підтвердження.
 */
function VerifyEmail() {
  const token = useSearchParams().get('token') ?? ''
  const [state, setState] = useState<State>({ kind: 'ready' })

  if (token === '') {
    return (
      <>
        <FormStatus error={new Error('Посилання неповне — у ньому немає токена.')} />
        <p className="form__aside">
          Увійдіть і замовте новий лист у <Link href="/profile">профілі</Link>.
        </p>
      </>
    )
  }

  if (state.kind === 'confirmed') {
    return (
      <>
        <FormStatus success={`Адресу ${state.email} підтверджено.`} />
        <p className="form__aside">
          <Link href="/profile">До профілю</Link>
        </p>
      </>
    )
  }

  async function confirm(): Promise<void> {
    setState({ kind: 'confirming' })

    try {
      const { user } = await apiRequest('/auth/email-verification/confirm', {
        method: 'POST',
        body: { token },
        schema: sessionResponseSchema,
      })

      setState({ kind: 'confirmed', email: user.email })
    } catch (error) {
      setState({
        kind: 'failed',
        error: error instanceof ApiRequestError ? error : new Error(describeError(error)),
      })
    }
  }

  const pending = state.kind === 'confirming'

  return (
    <>
      {state.kind === 'failed' && <FormStatus error={state.error} />}

      <p className="lede">
        Натисніть кнопку, щоб підтвердити адресу. Посилання одноразове й діє добу.
      </p>

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          void confirm()
        }}
      >
        <button type="submit" disabled={pending}>
          {pending ? 'Підтверджую…' : 'Підтвердити адресу'}
        </button>
      </form>

      {state.kind === 'failed' && (
        <p className="form__aside">
          Якщо посилання застаріло або вже використане — замовте новий лист у{' '}
          <Link href="/profile">профілі</Link>.
        </p>
      )}
    </>
  )
}

export default function VerifyEmailPage() {
  return (
    <main className="page page--narrow">
      <h1>Підтвердження пошти</h1>
      {/* useSearchParams вимагає межу Suspense, інакше сторінка не пререндериться. */}
      <Suspense fallback={<p className="status status--pending">Читаю посилання…</p>}>
        <VerifyEmail />
      </Suspense>
    </main>
  )
}
