import Link from 'next/link'

type AddBookSuccessProps = {
  title: string
  workId: string
  onRepeatEdition: () => void
  onAddNext: () => void
  onScanNext: () => void
}

export function AddBookSuccess({
  title,
  workId,
  onRepeatEdition,
  onAddNext,
  onScanNext,
}: AddBookSuccessProps) {
  return (
    <>
      <div className="alert alert--ok" role="status">
        <p>«{title}» тепер у вашій бібліотеці.</p>
      </div>
      <div className="actions" aria-label="Додати ще">
        <button type="button" onClick={onRepeatEdition}>
          Ще один такий примірник
        </button>
        <button type="button" onClick={onAddNext}>
          Додати наступну книгу
        </button>
        <button type="button" onClick={onScanNext}>
          Сканувати наступну
        </button>
      </div>
      <p className="form__aside">
        <Link href="/library">До бібліотеки</Link> ·{' '}
        <Link href={`/works/${workId}`}>Сторінка твору</Link>
      </p>
    </>
  )
}
