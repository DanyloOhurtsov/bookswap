'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { PASSWORD_LIMITS, confirmPasswordResetRequestSchema } from '@bookswap/shared'
import { TextField } from '../components/form-field'
import { FormStatus } from '../components/form-status'
import { ApiRequestError, apiRequest, describeError } from '../lib/api'
import { validate, type FieldErrors } from '../lib/validation'

function ResetPasswordForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  // Порожній стан: на сторінку зайшли без посилання з листа.
  if (token === '') {
    return (
      <>
        <FormStatus error={new Error('Посилання неповне — у ньому немає токена.')} />
        <p className="form__aside">
          <Link href="/forgot-password">Замовити новий лист</Link>
        </p>
      </>
    )
  }

  if (done) {
    return (
      <>
        <FormStatus success="Пароль змінено. Усі попередні сесії завершено — увійдіть заново." />
        <p className="form__aside">
          <Link href="/login">Увійти</Link>
        </p>
      </>
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(confirmPasswordResetRequestSchema, { token, password })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      await apiRequest('/auth/password-reset/confirm', { method: 'POST', body: result.data })

      setDone(true)
      router.prefetch('/login')
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <FormStatus error={failure} />

      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <TextField
          id="password"
          label="Новий пароль"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint={`Щонайменше ${String(PASSWORD_LIMITS.min)} символів.`}
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Зберігаю…' : 'Встановити пароль'}
        </button>
      </form>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <main className="page page--narrow">
      <h1>Новий пароль</h1>
      {/* useSearchParams вимагає межу Suspense, інакше сторінка не пререндериться. */}
      <Suspense fallback={<p className="status status--pending">Читаю посилання…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  )
}
