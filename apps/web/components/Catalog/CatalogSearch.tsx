'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FieldErrors, validate } from '@/app/lib/validation'
import { useCatalogSearch } from '@/app/lib/use-catalog'
import { catalogSearchRequestSchema } from '@bookswap/shared'
import { Shell } from '@/components/Shell'
import { FormStatus } from '@/components/Form/FormStatus'
import { TextField } from '@/components/Form/FormFields'
import { CatalogItem } from '@/components/Catalog/CatalogItem'
import { EmptyState, LoadingState } from '@/components/PageState'

function CatalogSearch() {
  const router = useRouter()
  const parameters = useSearchParams()

  // Запит живе в URL: посилання на пошук можна надіслати, і кнопка «назад»
  // працює так, як людина очікує.
  const submitted = parameters.get('q') ?? ''
  const [query, setQuery] = useState(submitted)
  const [syncedWith, setSyncedWith] = useState(submitted)
  const [errors, setErrors] = useState<FieldErrors>({})
  const search = useCatalogSearch(submitted)

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

  return (
    <Shell title="Каталог">
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

      {search.status === 'loading' && <LoadingState>Шукаю в каталозі…</LoadingState>}
      {search.status === 'error' && <FormStatus error={new Error(search.message)} />}

      {search.status === 'idle' && (
        <EmptyState title="Почніть із пошуку">
          Уведіть щонайменше два символи — і побачите, що вже є в каталозі.
        </EmptyState>
      )}

      {search.status === 'ready' && (
        <>
          {search.response.results.length === 0 ? (
            <EmptyState title="Нічого схожого не знайшлося">
              Схоже, цього твору в каталозі ще немає — його можна додати вручну.
            </EmptyState>
          ) : (
            <ul className="books">
              {search.response.results.map((result) => (
                <CatalogItem key={result.work.id} result={result} />
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
    </Shell>
  )
}

export { CatalogSearch }
