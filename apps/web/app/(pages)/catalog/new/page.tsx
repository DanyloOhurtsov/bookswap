'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { workDetailResponseSchema } from '@bookswap/shared'
import { FormStatus } from '@/components/Form/FormStatus'
import {
  AddBookShell,
  completeAddBook,
  continueAfterEdition,
  continueAfterTranslation,
  continueAfterWork,
  CopyStep,
  createSearchStep,
  EditionStep,
  SearchStep,
  selectExistingEdition,
  selectExistingWork,
  startNewWork,
  type AddBookStep,
  TranslationStep,
  WorkStep,
} from '@/features/catalog/add-book/index.client'
import { ApiRequestError, apiRequest, describeError } from '../../../lib/api'
import { useSession } from '../../../lib/use-session'

/**
 * §6.3, кроки 1–5: спершу пошук дублікатів (Етап 7c), потім — залежно від того,
 * що знайшлося, — одна з чотирьох гілок:
 *
 * 1. Знайшовся точний збіг `Edition` — створюється лише `Copy`.
 * 2. Знайшовся `Work` без потрібного видання — одразу `Translation` (опційно) →
 *    `Edition` → `Copy`.
 * 3. Нічого не знайшлося — повний ланцюг `Work` → `Translation` → `Edition` →
 *    `Copy`.
 *
 * Кроки самого ланцюга окремі, бо це різні сутності (§3), і злиття їх в одну
 * форму — рівно та помилка, від якої застерігає глосарій. Крок перекладу можна
 * пропустити: книжка мовою оригіналу перекладу не має.
 *
 * Пошук за ISBN паралельно тягне автозаповнення (Етап 7b, `/catalog/lookup`):
 * дані підставляються у форму `Work`/`Edition`, але лишаються звичайними
 * контрольованими полями — людина бачить і за потреби виправляє їх до
 * збереження.
 *
 * Автор ніколи не підбирається автоматично за збігом імені: тезки бувають, тож
 * людина або обирає наявного зі списку, або свідомо заводить нового.
 */
export default function NewBookPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <h1>Додати книжку</h1>
          <p className="status status--pending">Читаю запит…</p>
        </main>
      }
    >
      <Wizard />
    </Suspense>
  )
}

function Wizard() {
  const router = useRouter()
  const parameters = useSearchParams()
  const { state: session } = useSession()
  const presetWorkId = parameters.get('workId')

  const [step, setStep] = useState<AddBookStep>(createSearchStep)
  const [failure, setFailure] = useState<unknown>()

  useEffect(() => {
    if (session.status === 'guest') router.replace('/login')
  }, [session.status, router])

  // Прихід із сторінки твору: метадані вже є, лишається доповнити їх виданням.
  useEffect(() => {
    if (presetWorkId === null) return

    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const detail = await apiRequest(`/works/${encodeURIComponent(presetWorkId ?? '')}`, {
          schema: workDetailResponseSchema,
          signal: controller.signal,
        })

        setStep(selectExistingWork({ workId: detail.work.id, title: detail.work.title }))
      } catch (error) {
        if (controller.signal.aborted) return

        setFailure(error instanceof ApiRequestError ? error : new Error(describeError(error)))
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [presetWorkId])

  if (session.status === 'loading') {
    return (
      <AddBookShell step={step}>
        <p className="status status--pending">Перевіряю сесію…</p>
      </AddBookShell>
    )
  }

  if (session.status !== 'authenticated') {
    return (
      <AddBookShell step={step}>
        <p className="status status--pending">Потрібен вхід. Переадресовую…</p>
      </AddBookShell>
    )
  }

  return (
    <AddBookShell step={step}>
      <FormStatus error={failure} />

      {step.kind === 'search' && (
        <SearchStep
          initialQuery={parameters.get('q') ?? ''}
          onFoundEdition={(selection) => {
            setStep(selectExistingEdition(selection))
          }}
          onFoundWork={(selection) => {
            setStep(selectExistingWork(selection))
          }}
          onCreateNew={(selection) => {
            setStep(startNewWork(selection))
          }}
        />
      )}

      {step.kind === 'work' && (
        <WorkStep
          initialTitle={step.initialTitle}
          lookup={step.lookup}
          onCreated={(workId, title) => {
            setStep(continueAfterWork(step, { workId, title }))
          }}
        />
      )}

      {step.kind === 'translation' && (
        <TranslationStep
          workId={step.workId}
          lookup={step.lookup}
          existingTranslations={step.existingTranslations}
          onDone={(translationId) => {
            setStep(continueAfterTranslation(step, translationId))
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
            setStep(continueAfterEdition(step, editionId))
          }}
        />
      )}

      {step.kind === 'copy' && (
        <CopyStep
          editionId={step.editionId}
          onDone={() => {
            setStep(completeAddBook(step))
          }}
        />
      )}

      {step.kind === 'done' && (
        <>
          <div className="alert alert--ok" role="status">
            <p>«{step.title}» тепер у вашій бібліотеці.</p>
          </div>
          <p className="form__aside">
            <Link href="/library">До бібліотеки</Link> ·{' '}
            <Link href={`/works/${step.workId}`}>Сторінка твору</Link> ·{' '}
            <Link href="/catalog">Шукати далі</Link>
          </p>
        </>
      )}
    </AddBookShell>
  )
}
