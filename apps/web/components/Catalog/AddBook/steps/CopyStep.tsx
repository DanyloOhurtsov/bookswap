'use client'

import { useState, type FormEvent } from 'react'
import {
  CONDITION,
  VISIBILITY,
  addCopyRequestSchema,
  copyResponseSchema,
  type Condition,
  type Visibility,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { CONDITION_LABELS, VISIBILITY_LABELS } from '@/app/lib/labels'
import { validate, type FieldErrors } from '@/app/lib/validation'
import { SelectField, TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'

export function CopyStep({ editionId, onDone }: { editionId: string; onDone: () => void }) {
  const [condition, setCondition] = useState<Condition>('GOOD')
  const [visibility, setVisibility] = useState<Visibility>('FRIENDS')
  const [note, setNote] = useState('')
  const [acquiredAt, setAcquiredAt] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(addCopyRequestSchema, {
      editionId,
      condition,
      visibility,
      note: note.trim() === '' ? null : note,
      acquiredAt: acquiredAt === '' ? null : acquiredAt,
    })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      await apiRequest('/me/library', {
        method: 'POST',
        body: result.data,
        schema: copyResponseSchema,
      })

      onDone()
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <FormStatus error={failure} />

      <SelectField
        id="copy-condition"
        label="Стан примірника"
        value={condition}
        onChange={(event) => {
          setCondition(event.target.value as Condition)
        }}
      >
        {CONDITION.map((value) => (
          <option key={value} value={value}>
            {CONDITION_LABELS[value]}
          </option>
        ))}
      </SelectField>

      <SelectField
        id="copy-visibility"
        label="Кому показувати"
        value={visibility}
        onChange={(event) => {
          setVisibility(event.target.value as Visibility)
        }}
      >
        {VISIBILITY.map((value) => (
          <option key={value} value={value}>
            {VISIBILITY_LABELS[value]}
          </option>
        ))}
      </SelectField>

      <TextField
        id="copy-note"
        label="Нотатка"
        hint="Видно лише вам."
        value={note}
        error={errors.note}
        onChange={(event) => {
          setNote(event.target.value)
        }}
      />

      <TextField
        id="copy-acquired"
        label="Коли зʼявилася"
        type="date"
        value={acquiredAt}
        error={errors.acquiredAt}
        onChange={(event) => {
          setAcquiredAt(event.target.value)
        }}
      />

      <button type="submit" disabled={pending}>
        {pending ? 'Додаю…' : 'Додати до бібліотеки'}
      </button>
    </form>
  )
}
