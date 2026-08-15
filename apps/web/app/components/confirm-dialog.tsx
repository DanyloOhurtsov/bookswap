'use client'

import { useEffect, useId, useRef } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** Що саме станеться. Показується завжди, коли наслідок неочевидний. */
  description?: string
  confirmLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Підтвердження руйнівної дії.
 *
 * Нативний `<dialog>` + `showModal()`, а не саморобний оверлей: браузер сам дає
 * фокус-трап, `Esc`, інертність тла й повернення фокуса на елемент, з якого діалог
 * відкрили. Це рівно те, що `FieldShell` робить руками для полів, — і рівно те,
 * що в саморобних модалках забувають першим.
 *
 * `showModal()` викликається в ефекті, бо декларативного атрибута для модального
 * режиму немає: `<dialog open>` показує немодальний діалог без жодної з цих переваг.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current

    if (dialog === null) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      // alertdialog, а не dialog: рішення руйнівне, і екранний читач має зачитати
      // текст одразу, а не чекати, поки користувач до нього дійде.
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        // Esc: гасимо стандартне закриття, щоб стан діалогу лишався за батьком —
        // інакше `open` і реальний стан розходяться.
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 className="dialog__title" id={titleId}>
        {title}
      </h2>
      {description !== undefined && <p id={descriptionId}>{description}</p>}

      <div className="dialog__actions">
        <button type="button" className="button--ghost" onClick={onCancel} disabled={pending}>
          Скасувати
        </button>
        <button type="button" className="button--danger" onClick={onConfirm} disabled={pending}>
          {pending ? 'Виконую…' : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
