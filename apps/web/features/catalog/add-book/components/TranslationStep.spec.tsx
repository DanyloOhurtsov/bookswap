/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { Translation, TranslationResponse } from '@bookswap/shared'
import { ApiRequestError } from '@/app/lib/api'
import { TranslationStep } from './TranslationStep'

jest.mock('@/app/lib/api', () => {
  const actual = jest.requireActual<typeof import('@/app/lib/api')>('@/app/lib/api')

  return { ...actual, apiRequest: jest.fn() }
})

const { apiRequest: mockApiRequest } = jest.requireMock<{ apiRequest: jest.Mock }>('@/app/lib/api')

const existingTranslation: Translation = {
  id: 'translation-existing',
  workId: 'work-1',
  translator: 'Старий Перекладач',
  lang: 'fr',
  sourceLang: 'en',
  year: 1999,
  isAbridged: false,
  hasNotes: false,
  notes: null,
  editionCount: 2,
}

const createdTranslation: TranslationResponse = {
  translation: {
    ...existingTranslation,
    id: 'translation-new',
    translator: 'Новий Перекладач',
    lang: 'pl',
    year: null,
    isAbridged: true,
    hasNotes: true,
  },
}

function renderStep(options: { lookupLanguage?: string; existing?: Translation[] } = {}) {
  const onDone = jest.fn()
  render(
    <TranslationStep
      workId="work-1"
      lookup={
        options.lookupLanguage === undefined
          ? undefined
          : { title: 'Lookup title', language: options.lookupLanguage }
      }
      existingTranslations={options.existing}
      onDone={onDone}
    />,
  )

  return onDone
}

beforeEach(() => {
  mockApiRequest.mockReset()
})

it('skips an original-language edition without creating a Translation', async () => {
  const onDone = renderStep()
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Пропустити — це оригінал' }))

  expect(onDone).toHaveBeenCalledWith(null)
  expect(mockApiRequest).not.toHaveBeenCalled()
})

it('reuses an explicitly selected existing Translation without changing it', async () => {
  const onDone = renderStep({ lookupLanguage: 'de', existing: [existingTranslation] })
  const user = userEvent.setup()

  expect(screen.getByText(/Старий Перекладач · fr · 1999/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Використати цей переклад' }))

  expect(onDone).toHaveBeenCalledWith('translation-existing')
  expect(mockApiRequest).not.toHaveBeenCalled()
})

it('keeps lookup language editable and submits nullable and boolean fields', async () => {
  mockApiRequest.mockResolvedValue(createdTranslation)
  const onDone = renderStep({ lookupLanguage: 'de' })
  const user = userEvent.setup()

  expect(screen.getByLabelText('Мова перекладу')).toHaveValue('de')
  expect(screen.getByLabelText('З якої мови перекладено')).toHaveValue('')

  await user.type(screen.getByLabelText('Перекладач'), 'Новий Перекладач')
  await user.clear(screen.getByLabelText('Мова перекладу'))
  await user.type(screen.getByLabelText('Мова перекладу'), 'pl')
  await user.type(screen.getByLabelText('З якої мови перекладено'), 'en')
  await user.click(screen.getByLabelText('Скорочений переклад'))
  await user.click(screen.getByLabelText('Є примітки й коментарі перекладача'))
  await user.click(screen.getByRole('button', { name: 'Далі: видання' }))

  await waitFor(() => {
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/works/work-1/translations',
      expect.objectContaining({
        method: 'POST',
        body: {
          translator: 'Новий Перекладач',
          lang: 'pl',
          sourceLang: 'en',
          year: null,
          isAbridged: true,
          hasNotes: true,
        },
      }),
    )
  })
  expect(onDone).toHaveBeenCalledWith('translation-new')
})

it('shows shared validation errors without sending an invalid request', async () => {
  renderStep()
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Далі: видання' }))

  expect(await screen.findByText('Не вказано перекладача')).toBeInTheDocument()
  expect(mockApiRequest).not.toHaveBeenCalled()
})

it('keeps form values and exposes a create-Translation API error', async () => {
  mockApiRequest.mockRejectedValue(
    new ApiRequestError(409, { code: 'CONFLICT', message: 'Такий переклад уже існує' }),
  )
  renderStep()
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('Перекладач'), 'Новий Перекладач')
  await user.type(screen.getByLabelText('З якої мови перекладено'), 'en')
  await user.type(screen.getByLabelText('Рік перекладу'), '1985')
  await user.click(screen.getByRole('button', { name: 'Далі: видання' }))

  expect(await screen.findByText('Такий переклад уже існує')).toBeInTheDocument()
  expect(screen.getByLabelText('Перекладач')).toHaveValue('Новий Перекладач')
  expect(screen.getByLabelText('Рік перекладу')).toHaveValue(1985)
  expect(mockApiRequest).toHaveBeenCalledWith(
    '/works/work-1/translations',
    expect.objectContaining({ body: expect.objectContaining({ year: 1985 }) }),
  )
})
