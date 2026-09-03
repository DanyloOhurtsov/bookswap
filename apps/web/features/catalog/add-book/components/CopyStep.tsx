'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  CONDITION,
  VISIBILITY,
  addCopyRequestSchema,
  copyResponseSchema,
  type AddCopyRequest,
} from '@bookswap/shared'
import { useState } from 'react'
import { useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { CONDITION_LABELS, VISIBILITY_LABELS } from '@/app/lib/labels'
import { SelectField, TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { nullableText } from '../model/form-values'

type CopyStepProps = {
  editionId: string
  onDone: () => void
}

type CopyFieldsProps = {
  errors: FieldErrors<AddCopyRequest>
  register: UseFormRegister<AddCopyRequest>
}

function defaultValues(editionId: string): AddCopyRequest {
  return {
    editionId,
    condition: 'GOOD',
    visibility: 'FRIENDS',
    note: null,
    acquiredAt: null,
  }
}

function CopyFields({ errors, register }: CopyFieldsProps) {
  return (
    <>
      <SelectField id="copy-condition" label="Стан примірника" {...register('condition')}>
        {CONDITION.map((value) => (
          <option key={value} value={value}>
            {CONDITION_LABELS[value]}
          </option>
        ))}
      </SelectField>
      <SelectField id="copy-visibility" label="Кому показувати" {...register('visibility')}>
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
        error={errors.note?.message}
        {...register('note', { setValueAs: nullableText })}
      />
      <TextField
        id="copy-acquired"
        label="Коли зʼявилася"
        type="date"
        error={errors.acquiredAt?.message}
        {...register('acquiredAt', { setValueAs: nullableText })}
      />
    </>
  )
}

export function CopyStep({ editionId, onDone }: CopyStepProps) {
  const [failure, setFailure] = useState<unknown>()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddCopyRequest>({
    resolver: zodResolver(addCopyRequestSchema),
    defaultValues: defaultValues(editionId),
  })

  async function submit(request: AddCopyRequest): Promise<void> {
    setFailure(undefined)

    try {
      await apiRequest('/me/library', {
        method: 'POST',
        body: request,
        schema: copyResponseSchema,
      })
      onDone()
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    }
  }

  return (
    <form className="form" onSubmit={(event) => void handleSubmit(submit)(event)} noValidate>
      <FormStatus error={failure} />
      <CopyFields errors={errors} register={register} />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Додаю…' : 'Додати до бібліотеки'}
      </button>
    </form>
  )
}
