import type { BookLookupResult } from '@bookswap/shared'
import {
  completeAddBook,
  continueAfterEdition,
  continueAfterTranslation,
  continueAfterWork,
  createSearchStep,
  selectExistingEdition,
  selectExistingWork,
  startNewWork,
} from './add-book-step'

const lookup: BookLookupResult = {
  title: 'The Left Hand of Darkness',
  authors: ['Ursula K. Le Guin'],
  language: 'en',
}

describe('add-book wizard transitions', () => {
  it('creates a fresh search step for initial state or reset', () => {
    expect(createSearchStep()).toEqual({ kind: 'search' })
    expect(createSearchStep()).not.toBe(createSearchStep())
  })

  it('routes an exact edition directly to the copy step', () => {
    expect(
      selectExistingEdition({ workId: 'work-1', title: 'Book', editionId: 'edition-1' }),
    ).toEqual({ kind: 'copy', workId: 'work-1', title: 'Book', editionId: 'edition-1' })
  })

  it('preserves ISBN and lookup through the creation chain', () => {
    const work = startNewWork({
      initialTitle: 'Book',
      isbn: '9783161484100',
      lookup,
    })
    const translationStep = continueAfterWork(work, { workId: 'work-1', title: 'Book' })
    const editionStep = continueAfterTranslation(translationStep, null)
    const copyStep = continueAfterEdition(editionStep, 'edition-1')

    expect(translationStep).toMatchObject({ isbn: '9783161484100', lookup })
    expect(editionStep).toMatchObject({ isbn: '9783161484100', lookup })
    expect(completeAddBook(copyStep)).toEqual({ kind: 'done', workId: 'work-1', title: 'Book' })
  })

  it('starts an existing work at translation selection', () => {
    expect(selectExistingWork({ workId: 'work-1', title: 'Book' })).toEqual({
      kind: 'translation',
      workId: 'work-1',
      title: 'Book',
    })
  })
})
