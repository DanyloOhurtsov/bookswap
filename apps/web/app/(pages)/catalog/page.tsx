'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { catalogSearchRequestSchema, type CatalogSearchResult } from '@bookswap/shared'
import { AuthorLine, EditionLine } from '@/components/BookParts'
import { useSession } from '@/app/lib/use-session'
import { FieldErrors, validate } from '@/app/lib/validation'
import { useCatalogSearch } from '@/app/lib/use-catalog'
import { FormStatus } from '@/components/Form/FormStatus'
import { TextField } from '@/components/Form/FormFields'

/**
 * §6.3, кроки 1–2: людина вводить назву або ISBN і бачить «Можливо, це одна з
 * цих?» — разом із виданнями, бо саме на них вона впізнає своє.
 *
 * Це найважливіший екран сервісу: він прибирає більшість дублікатів ще до їхньої
 * появи. Тому кнопка «Створити новий твір» стоїть ПІД результатами, а не поруч
 * із пошуком — спершу подивись, чи його вже завели.
 */
export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="status status--pending">Читаю запит…</p>
        </Shell>
      }
    >
      <CatalogSearch />
    </Suspense>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page">
      <h1>Каталог</h1>
      {children}
    </main>
  )
}

function CatalogSearch() {
  const router = useRouter()
  const parameters = useSearchParams()
  const { state: session } = useSession()

  // Запит живе в URL: посилання на пошук можна надіслати, і кнопка «назад»
  // працює так, як людина очікує.
  const submitted = parameters.get('q') ?? ''
  const [query, setQuery] = useState(submitted)
  const [syncedWith, setSyncedWith] = useState(submitted)
  const [errors, setErrors] = useState<FieldErrors>({})
  const search = useCatalogSearch(submitted)

  useEffect(() => {
    if (session.status === 'guest') router.replace('/login')
  }, [session.status, router])

  // Кнопка «назад» міняє `?q=` — поле має піти за нею. Підлаштування стану під
  // час рендеру, а не в ефекті: ефект дав би зайвий прохід рендеру з розʼїханими
  // полем і адресою, і React цього прямо не радить.
  if (submitted !== syncedWith) {
    setSyncedWith(submitted)
    setQuery(submitted)
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const result = validate(catalogSearchRequestSchema, { q: query })

    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    router.push(`/catalog?q=${encodeURIComponent(result.data.q)}`)
  }

  if (session.status === 'loading') {
    return (
      <Shell>
        <p className="status status--pending">Перевіряю сесію…</p>
      </Shell>
    )
  }

  if (session.status !== 'authenticated') {
    return (
      <Shell>
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="lede">
        Спершу пошукайте книжку тут: якщо її вже завели, вам лишиться додати собі примірник.
      </p>

      <form className="search" onSubmit={submit} noValidate>
        <TextField
          id="catalog-query"
          label="Назва, автор або ISBN"
          name="q"
          autoComplete="off"
          hint="Мінімум два символи. Друкарська помилка пошуку не завадить."
          value={query}
          error={errors.q ?? errors.form}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
        <button type="submit">Знайти</button>
      </form>

      {search.status === 'loading' && <p className="status status--pending">Шукаю…</p>}
      {search.status === 'error' && <FormStatus error={new Error(search.message)} />}

      {search.status === 'idle' && (
        <p className="empty">Уведіть щонайменше два символи — і побачите, що вже є в базі.</p>
      )}

      {search.status === 'ready' && (
        <>
          {search.response.results.length === 0 ? (
            <p className="empty">
              Нічого схожого не знайшлося. Схоже, цього твору в базі ще немає — заведіть його.
            </p>
          ) : (
            <ul className="books">
              {search.response.results.map((result) => (
                <WorkCard key={result.work.id} result={result} />
              ))}
            </ul>
          )}

          <p className="form__aside">
            Не знайшли своє?{' '}
            <Link href={`/catalog/new?q=${encodeURIComponent(submitted)}`}>
              Додати книжку вручну
            </Link>
          </p>
        </>
      )}

      <p className="form__aside">
        <Link href="/library">Моя бібліотека</Link> · <Link href="/friends">Друзі</Link> ·{' '}
        <Link href="/">На головну</Link>
      </p>
    </Shell>
  )
}

const MATCH_LABELS: Readonly<Record<CatalogSearchResult['matchedOn'], string>> = {
  TITLE: 'збіг за назвою',
  AUTHOR: 'збіг за автором',
  ISBN: 'точний збіг за ISBN',
}

function WorkCard({ result }: { result: CatalogSearchResult }) {
  return (
    <li className="book">
      <Link className="book__title" href={`/works/${result.work.id}`}>
        {result.work.title}
      </Link>
      <AuthorLine authors={result.authors} />
      <span className="book__meta">{MATCH_LABELS[result.matchedOn]}</span>

      {result.editions.length === 0 ? (
        <p className="empty">Видань ще не додано.</p>
      ) : (
        <ul className="book__editions">
          {result.editions.map((edition) => (
            <li key={edition.id}>
              <EditionLine edition={edition} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
