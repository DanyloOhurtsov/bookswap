'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { loginRequestSchema, sessionResponseSchema } from '@bookswap/shared'
import { TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { ApiRequestError, apiRequest, describeError } from '../../lib/api'
import { validate, type FieldErrors } from '../../lib/validation'

export default function LoginPage() {
  const router = useRouter()
  const [fields, setFields] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(loginRequestSchema, fields)

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      await apiRequest('/auth/login', {
        method: 'POST',
        body: result.data,
        schema: sessionResponseSchema,
      })

      router.push('/profile')
    } catch (error) {
      // INVALID_CREDENTIALS показується як помилка форми, а не поля: сервер
      // навмисно не каже, що саме не так, і підсвічувати email було б домислом.
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="page page--narrow">
      <h1>Вхід</h1>

      <FormStatus error={failure} />

      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <TextField
          id="email"
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={fields.email}
          error={errors.email}
          onChange={(event) => {
            setFields({ ...fields, email: event.target.value })
          }}
        />

        <TextField
          id="password"
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={fields.password}
          error={errors.password}
          onChange={(event) => {
            setFields({ ...fields, password: event.target.value })
          }}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Входжу…' : 'Увійти'}
        </button>
      </form>

      <p className="form__aside">
        <Link href="/forgot-password">Забули пароль?</Link> ·{' '}
        <Link href="/register">Зареєструватися</Link>
      </p>
    </main>
  )
}
