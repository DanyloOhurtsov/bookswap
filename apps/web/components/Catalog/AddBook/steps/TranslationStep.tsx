'use client'

import { useState, type FormEvent } from 'react'
import {
  createTranslationRequestSchema,
  translationResponseSchema,
  type BookLookupResult,
  type Translation,
} from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { mapLookupResultToDraft } from '@/app/lib/lookup-mapping'
import { validate, type FieldErrors } from '@/app/lib/validation'
import { TextField } from '@/components/Form/FormFields'
import { FormStatus } from '@/components/Form/FormStatus'
import { LanguageField } from '@/components/Form/LanguageField'

export function TranslationStep({
  workId,
  lookup,
  existingTranslations,
  onDone,
}: {
  workId: string
  lookup?: BookLookupResult
  existingTranslations?: Translation[]
  onDone: (translationId: string | null) => void
}) {
  const draft = mapLookupResultToDraft(lookup)
  const [translator, setTranslator] = useState('')
  // §6.3 п.7: мова ISBN-видання описує мову цього тексту — єдине домен-коректне
  // місце для неї тут, у мові перекладу. `sourceLang` лишається незаповненою:
  // з якої мови перекладено provider не повідомляє, і вгадувати заборонено.
  const [lang, setLang] = useState(draft.translationLang ?? 'uk')
  const [sourceLang, setSourceLang] = useState('')
  const [year, setYear] = useState('')
  const [isAbridged, setIsAbridged] = useState(false)
  const [hasNotes, setHasNotes] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<unknown>()
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setFailure(undefined)

    const result = validate(createTranslationRequestSchema, {
      translator,
      lang,
      sourceLang,
      year: year === '' ? null : Number(year),
      isAbridged,
      hasNotes,
    })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setPending(true)

    try {
      const response = await apiRequest(`/works/${workId}/translations`, {
        method: 'POST',
        body: result.data,
        schema: translationResponseSchema,
      })

      onDone(response.translation.id)
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {existingTranslations !== undefined && existingTranslations.length > 0 && (
        <>
          <p className="lede">У цього твору вже є переклади — можливо, ваш серед них.</p>
          <ul className="books">
            {existingTranslations.map((existing) => (
              <li className="book" key={existing.id}>
                <span className="book__meta">
                  {existing.translator} · {existing.lang}
                  {existing.year === null ? '' : ` · ${String(existing.year)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Наявний переклад передається як є — lookup-мова сюди не
                    // потрапляє: наявний запис не редагується цим кроком.
                    onDone(existing.id)
                  }}
                >
                  Використати цей переклад
                </button>
              </li>
            ))}
          </ul>
          <p className="form__aside">Або заведіть новий переклад нижче.</p>
        </>
      )}

      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <FormStatus error={failure} />

        <p className="form__aside">
          Якщо ваш примірник мовою оригіналу — цей крок можна пропустити.
        </p>

        {draft.translationLang !== undefined && (
          <div className="alert alert--ok" role="status">
            <p>
              Мову підставлено з зовнішнього джерела за виданням — перевірте й виправте за потреби.
            </p>
          </div>
        )}

        <TextField
          id="translation-translator"
          label="Перекладач"
          value={translator}
          error={errors.translator}
          onChange={(event) => {
            setTranslator(event.target.value)
          }}
        />

        <LanguageField
          id="translation-lang"
          label="Мова перекладу"
          value={lang}
          error={errors.lang}
          onChange={setLang}
        />

        <LanguageField
          id="translation-source"
          label="З якої мови перекладено"
          hint="Переклад з оригіналу і переказ із підрядника — різні речі (§10.3)."
          value={sourceLang}
          error={errors.sourceLang}
          onChange={setSourceLang}
        />

        <TextField
          id="translation-year"
          label="Рік перекладу"
          type="number"
          inputMode="numeric"
          value={year}
          error={errors.year}
          onChange={(event) => {
            setYear(event.target.value)
          }}
        />

        <div className="field field--checkbox">
          <input
            id="translation-abridged"
            type="checkbox"
            checked={isAbridged}
            onChange={(event) => {
              setIsAbridged(event.target.checked)
            }}
          />
          <label htmlFor="translation-abridged">Скорочений переклад</label>
        </div>

        <div className="field field--checkbox">
          <input
            id="translation-notes"
            type="checkbox"
            checked={hasNotes}
            onChange={(event) => {
              setHasNotes(event.target.checked)
            }}
          />
          <label htmlFor="translation-notes">Є примітки й коментарі перекладача</label>
        </div>

        <div className="person__actions">
          <button type="submit" disabled={pending}>
            {pending ? 'Створюю…' : 'Далі: видання'}
          </button>
          <button
            type="button"
            className="button--ghost"
            disabled={pending}
            onClick={() => {
              onDone(null)
            }}
          >
            Пропустити — це оригінал
          </button>
        </div>
      </form>
    </>
  )
}
