'use client'

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

interface FieldShellProps {
  id: string
  label: string
  error?: string
  hint?: string
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}

/**
 * Обгортка поля форми з доступною розміткою.
 *
 * Три речі, які зазвичай губляться і без яких форма непридатна з екранним
 * читачем: `<label for>`, `aria-invalid` і `aria-describedby` на текст помилки.
 * Тому вони зібрані в одному місці, а не повторюються в кожній формі.
 */
function FieldShell({ id, label, error, hint, children }: FieldShellProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ')

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint !== undefined && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {children({
        id,
        describedBy: describedBy === '' ? undefined : describedBy,
        invalid: error !== undefined,
      })}
      {error !== undefined && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string
  label: string
  error?: string
  hint?: string
}

export function TextField({ id, label, error, hint, ...input }: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      {({ describedBy, invalid }) => (
        <input
          {...input}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </FieldShell>
  )
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  id: string
  label: string
  error?: string
  hint?: string
}

export function TextAreaField({ id, label, error, hint, ...textarea }: TextAreaFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      {({ describedBy, invalid }) => (
        <textarea
          {...textarea}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </FieldShell>
  )
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  id: string
  label: string
  error?: string
  hint?: string
}

export function SelectField({ id, label, error, hint, children, ...select }: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      {({ describedBy, invalid }) => (
        <select
          {...select}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        >
          {children}
        </select>
      )}
    </FieldShell>
  )
}
