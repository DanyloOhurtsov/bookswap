'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { workDetailResponseSchema, type BookLookupResult, type Translation } from '@bookswap/shared'
import { ApiRequestError, apiRequest, describeError } from '@/app/lib/api'
import { FormStatus } from '@/components/Form/FormStatus'
import { LoadingState } from '@/components/PageState'
import { Shell } from '@/components/Shell'
import { CopyStep, EditionStep, SearchStep, TranslationStep, WorkStep } from './steps'

/**
 * The flow is deliberately modeled as a discriminated union instead of a set
 * of loosely related booleans. Every state therefore carries exactly the data
 * that its screen needs, and impossible combinations cannot be rendered.
 */
type AddBookStep =
  | { kind: 'loading-work' }
  | { kind: 'search' }
  | { kind: 'work'; initialTitle: string; isbn?: string; lookup?: BookLookupResult }
  | {
      kind: 'translation'
      workId: string
      title: string
      isbn?: string
      lookup?: BookLookupResult
      existingTranslations?: Translation[]
    }
  | {
      kind: 'edition'
      workId: string
      title: string
      translationId: string | null
      isbn?: string
      lookup?: BookLookupResult
    }
  | { kind: 'copy'; workId: string; title: string; editionId: string }
  | { kind: 'done'; workId: string; title: string }

const STEP_DESCRIPTIONS: Readonly<Record<AddBookStep['kind'], string>> = {
  'loading-work': 'Готуємо дані твору для нового видання.',
  search: 'Спершу перевіримо каталог, щоб не створити дублікат.',
  work: 'Додайте основні дані твору та його авторів.',
  translation: 'Оберіть переклад, додайте новий або пропустіть цей етап для оригіналу.',
  edition: 'Опишіть конкретне видання: ISBN, видавництво, рік і формат.',
  copy: 'Вкажіть стан, видимість і нотатку саме для вашого примірника.',
  done: 'Книжку успішно додано до вашої бібліотеки.',
}

const STEP_TITLES: Readonly<Record<AddBookStep['kind'], string>> = {
  'loading-work': 'Підготовка видання',
  search: 'Пошук у каталозі',
  work: 'Твір',
  translation: 'Переклад',
  edition: 'Видання',
  copy: 'Ваш примірник',
  done: 'Готово',
}

/**
 * §6.3: the path is intentionally branching rather than a fixed five-step
 * wizard. An existing edition goes straight to Copy, an existing work starts
 * at Translation/Edition, and a completely new book follows the full chain.
 */
function AddBookFlow() {
  const parameters = useSearchParams()
  const presetWorkId = parameters.get('workId')
  const initialQuery = parameters.get('q') ?? ''

  return (
    <AddBookFlowController
      key={`${presetWorkId ?? 'search'}:${initialQuery}`}
      presetWorkId={presetWorkId}
      initialQuery={initialQuery}
    />
  )
}

function AddBookFlowController({
  presetWorkId,
  initialQuery,
}: {
  presetWorkId: string | null
  initialQuery: string
}) {
  const [step, setStep] = useState<AddBookStep>(() =>
    presetWorkId === null ? { kind: 'search' } : { kind: 'loading-work' },
  )
  const [failure, setFailure] = useState<unknown>()

  // Coming from a work page skips duplicate work search, but still reuses an
  // existing translation when possible. The old flow fetched translations and
  // then discarded them, which could lead to duplicate Translation records.
  useEffect(() => {
    if (presetWorkId === null) return

    const controller = new AbortController()

    async function loadWork(): Promise<void> {
      try {
        const detail = await apiRequest(`/works/${encodeURIComponent(presetWorkId ?? '')}`, {
          schema: workDetailResponseSchema,
          signal: controller.signal,
        })

        setStep({
          kind: 'translation',
          workId: detail.work.id,
          title: detail.work.title,
          existingTranslations: detail.translations,
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
        setStep({ kind: 'search' })
      }
    }

    void loadWork()

    return () => {
      controller.abort()
    }
  }, [presetWorkId])

  return (
    <Shell title="Додати книжку" description={STEP_DESCRIPTIONS[step.kind]}>
      <div className="mb-6 border-b pb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Поточний етап
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{STEP_TITLES[step.kind]}</h2>
      </div>

      <FormStatus error={failure} />

      {step.kind === 'loading-work' && <LoadingState>Завантажую дані твору…</LoadingState>}

      {step.kind === 'search' && (
        <SearchStep
          initialQuery={initialQuery}
          onFoundEdition={(workId, title, editionId) => {
            setStep({ kind: 'copy', workId, title, editionId })
          }}
          onFoundWork={({ workId, title, isbn, lookup, existingTranslations }) => {
            setStep({ kind: 'translation', workId, title, isbn, lookup, existingTranslations })
          }}
          onCreateNew={(initialTitle, isbn, lookup) => {
            setStep({ kind: 'work', initialTitle, isbn, lookup })
          }}
        />
      )}

      {step.kind === 'work' && (
        <WorkStep
          initialTitle={step.initialTitle}
          lookup={step.lookup}
          onCreated={(workId, title) => {
            setStep({ kind: 'translation', workId, title, isbn: step.isbn, lookup: step.lookup })
          }}
        />
      )}

      {step.kind === 'translation' && (
        <TranslationStep
          workId={step.workId}
          lookup={step.lookup}
          existingTranslations={step.existingTranslations}
          onDone={(translationId) => {
            setStep({
              kind: 'edition',
              workId: step.workId,
              title: step.title,
              translationId,
              isbn: step.isbn,
              lookup: step.lookup,
            })
          }}
        />
      )}

      {step.kind === 'edition' && (
        <EditionStep
          workId={step.workId}
          translationId={step.translationId}
          lookup={step.lookup}
          initialIsbn={step.isbn}
          onCreated={(editionId) => {
            setStep({ kind: 'copy', workId: step.workId, title: step.title, editionId })
          }}
        />
      )}

      {step.kind === 'copy' && (
        <CopyStep
          editionId={step.editionId}
          onDone={() => {
            setStep({ kind: 'done', workId: step.workId, title: step.title })
          }}
        />
      )}

      {step.kind === 'done' && <Completion workId={step.workId} title={step.title} />}
    </Shell>
  )
}

function Completion({ workId, title }: { workId: string; title: string }) {
  return (
    <div className="space-y-5">
      <div className="alert alert--ok" role="status">
        <p>«{title}» тепер у вашій бібліотеці.</p>
      </div>
      <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Наступні дії">
        <Link href="/library">До бібліотеки</Link>
        <Link href={`/works/${workId}`}>Сторінка твору</Link>
        <Link href="/catalog">Шукати далі</Link>
      </nav>
    </div>
  )
}

export { AddBookFlow }
