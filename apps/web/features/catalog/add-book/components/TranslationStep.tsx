'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  createTranslationRequestSchema,
  translationResponseSchema,
  type BookLookupResult,
  type CreateTranslationRequest,
  type Translation,
} from '@bookswap/shared'
import { useState } from 'react'
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { mapLookupResultToDraft } from '@/app/lib/lookup-mapping'
import { TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { LanguageField } from './LanguageField'

type TranslationStepProps = {
  workId: string
  lookup?: BookLookupResult
  existingTranslations?: Translation[]
  onDone: (translationId: string | null) => void
}

type ExistingTranslationsProps = {
  translations: Translation[]
  onSelect: (translationId: string) => void
}

type TranslationFieldsProps = {
  control: Control<CreateTranslationRequest>
  errors: FieldErrors<CreateTranslationRequest>
  register: UseFormRegister<CreateTranslationRequest>
}

function nullableNumber(value: unknown): unknown {
  return value === '' || value === null || value === undefined ? null : Number(value)
}

function defaultValues(translationLang: string | undefined): CreateTranslationRequest {
  return {
    translator: '',
    // Provider language describes this ISBN edition, never the source language.
    lang: translationLang ?? 'uk',
    sourceLang: '',
    year: null,
    isAbridged: false,
    hasNotes: false,
  }
}

function ExistingTranslations({ translations, onSelect }: ExistingTranslationsProps) {
  if (translations.length === 0) return null

  return (
    <>
      <p className="lede">У цього твору вже є переклади — можливо, ваш серед них.</p>
      <ul className="books">
        {translations.map((translation) => (
          <li className="book" key={translation.id}>
            <span className="book__meta">
              {translation.translator} · {translation.lang}
              {translation.year === null ? '' : ` · ${String(translation.year)}`}
            </span>
            <button type="button" onClick={() => onSelect(translation.id)}>
              Використати цей переклад
            </button>
          </li>
        ))}
      </ul>
      <p className="form__aside">Або заведіть новий переклад нижче.</p>
    </>
  )
}

function TranslationFields({ control, errors, register }: TranslationFieldsProps) {
  return (
    <>
      <TextField
        id="translation-translator"
        label="Перекладач"
        error={errors.translator?.message}
        {...register('translator')}
      />
      <Controller
        control={control}
        name="lang"
        render={({ field }) => (
          <LanguageField
            id="translation-lang"
            label="Мова перекладу"
            value={field.value}
            error={errors.lang?.message}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="sourceLang"
        render={({ field }) => (
          <LanguageField
            id="translation-source"
            label="З якої мови перекладено"
            hint="Переклад з оригіналу і переказ із підрядника — різні речі (§10.3)."
            value={field.value}
            error={errors.sourceLang?.message}
            onChange={field.onChange}
          />
        )}
      />
      <TextField
        id="translation-year"
        label="Рік перекладу"
        type="number"
        inputMode="numeric"
        error={errors.year?.message}
        {...register('year', { setValueAs: nullableNumber })}
      />
      <div className="field field--checkbox">
        <input id="translation-abridged" type="checkbox" {...register('isAbridged')} />
        <label htmlFor="translation-abridged">Скорочений переклад</label>
      </div>
      <div className="field field--checkbox">
        <input id="translation-notes" type="checkbox" {...register('hasNotes')} />
        <label htmlFor="translation-notes">Є примітки й коментарі перекладача</label>
      </div>
    </>
  )
}

export function TranslationStep({
  workId,
  lookup,
  existingTranslations = [],
  onDone,
}: TranslationStepProps) {
  const translationLang = mapLookupResultToDraft(lookup).translationLang
  const [failure, setFailure] = useState<unknown>()
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateTranslationRequest>({
    resolver: zodResolver(createTranslationRequestSchema),
    defaultValues: defaultValues(translationLang),
  })

  async function submit(request: CreateTranslationRequest): Promise<void> {
    setFailure(undefined)

    try {
      const response = await apiRequest(`/works/${workId}/translations`, {
        method: 'POST',
        body: request,
        schema: translationResponseSchema,
      })
      onDone(response.translation.id)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    }
  }

  return (
    <>
      <ExistingTranslations translations={existingTranslations} onSelect={onDone} />
      <form className="form" onSubmit={(event) => void handleSubmit(submit)(event)} noValidate>
        <FormStatus error={failure} />
        <p className="form__aside">
          Якщо ваш примірник мовою оригіналу — цей крок можна пропустити.
        </p>
        {translationLang !== undefined && (
          <div className="alert alert--ok" role="status">
            <p>
              Мову підставлено з зовнішнього джерела за виданням — перевірте й виправте за потреби.
            </p>
          </div>
        )}
        <TranslationFields control={control} errors={errors} register={register} />
        <div className="person__actions">
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Створюю…' : 'Далі: видання'}
          </button>
          <button
            type="button"
            className="button--ghost"
            disabled={isSubmitting}
            onClick={() => onDone(null)}
          >
            Пропустити — це оригінал
          </button>
        </div>
      </form>
    </>
  )
}
