'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { acceptedResponseSchema, requestPasswordResetRequestSchema } from '@bookswap/shared'
import { FormStatus } from '@/components/Form/FormStatus'
import { apiRequest, ApiRequestError, describeError } from '@/app/lib/api'
import { type FieldErrors, validate } from '@/app/lib/validation'
import { TextField } from '@/components/Form/FormFields'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(requestPasswordResetRequestSchema, { email })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      await apiRequest('/auth/password-reset', {
        method: 'POST',
        body: result.data,
        schema: acceptedResponseSchema,
      })

      setSent(true)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="page page--narrow">
      <h1>Скидання пароля</h1>

      {sent ? (
        <>
          {/*
            Формулювання навмисно не каже, чи існує акаунт: сервер такої
            інформації не дає (§6.1), і сторінка не має її вигадувати.
          */}
          <FormStatus success="Якщо акаунт із такою адресою існує, ми надіслали на неї лист із посиланням. Воно дійсне годину." />
          <p className="form__aside">
            <Link href="/login">Повернутися до входу</Link>
          </p>
        </>
      ) : (
        <>
          <p className="lede">
            Введіть адресу, і ми надішлемо посилання для встановлення нового пароля.
          </p>

          <FormStatus error={failure} />

          <form className="form" onSubmit={(event) => void submit(event)} noValidate>
            <TextField
              id="email"
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              error={errors.email}
              onChange={(event) => {
                setEmail(event.target.value)
              }}
            />

            <button type="submit" disabled={pending}>
              {pending ? 'Надсилаю…' : 'Надіслати посилання'}
            </button>
          </form>

          <p className="form__aside">
            <Link href="/login">Згадав пароль</Link>
          </p>
        </>
      )}
    </main>
  )
}
