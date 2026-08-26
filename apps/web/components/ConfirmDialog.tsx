'use client'

import { Button } from '@/components/ui/button'
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
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
      // alertdialog, а не dialog: рішення руйнівне, і екранний читач має зачитати текст одразу, а не чекати, поки користувач до нього дійде.
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        // Esc: гасимо стандартне закриття, щоб стан діалогу лишався за батьком — інакше `open` і реальний стан розходяться.
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="p-5">
        <h2 className="text-lg font-semibold" id={titleId}>
          {title}
        </h2>
        {description !== undefined && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground" id={descriptionId}>
            {description}
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 p-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Скасувати
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
          {pending ? 'Виконую…' : confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
