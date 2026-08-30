'use client'

import { LANGUAGE_HINTS } from '@/app/lib/labels'
import { TextField } from '@/components/index'

interface LanguageFieldProps {
  id: string
  label: string
  hint?: string
  value: string
  error?: string
  onChange: (value: string) => void
}

/** ISO 639-1 input with an accessible, instance-specific suggestion list. */
function LanguageField({ id, label, hint, value, error, onChange }: LanguageFieldProps) {
  const suggestionsId = `${id}-language-hints`

  return (
    <>
      <TextField
        id={id}
        label={label}
        hint={hint ?? 'Код ISO 639-1: uk, en, pl…'}
        list={suggestionsId}
        autoComplete="off"
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={suggestionsId}>
        {LANGUAGE_HINTS.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </datalist>
    </>
  )
}

export { LanguageField }
