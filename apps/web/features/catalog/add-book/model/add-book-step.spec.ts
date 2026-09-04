import type { BookLookupResult } from '@bookswap/shared'
import {
  completeAddBook,
  continueAfterEdition,
  continueAfterTranslation,
  continueAfterWork,
  createSearchStep,
  repeatSameEdition,
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
      selectExistingEdition({
        workId: 'work-1',
        title: 'Book',
        editionId: 'edition-1',
        entryMethod: 'MANUAL',
      }),
    ).toEqual({
      kind: 'copy',
      workId: 'work-1',
      title: 'Book',
      editionId: 'edition-1',
      entryMethod: 'MANUAL',
    })
  })

  it('preserves ISBN, lookup and entryMethod through the creation chain', () => {
    const work = startNewWork({
      initialTitle: 'Book',
      isbn: '9783161484100',
      lookup,
      entryMethod: 'BARCODE',
    })
    const translationStep = continueAfterWork(work, { workId: 'work-1', title: 'Book' })
    const editionStep = continueAfterTranslation(translationStep, null)
    const copyStep = continueAfterEdition(editionStep, 'edition-1')

    expect(translationStep).toMatchObject({ isbn: '9783161484100', lookup, entryMethod: 'BARCODE' })
    expect(editionStep).toMatchObject({ isbn: '9783161484100', lookup, entryMethod: 'BARCODE' })
    expect(copyStep).toMatchObject({ entryMethod: 'BARCODE' })

    const doneStep = completeAddBook(copyStep)

    expect(doneStep).toEqual({
      kind: 'done',
      workId: 'work-1',
      title: 'Book',
      editionId: 'edition-1',
    })

    // §R11: "another copy of this" never counts as a new scan.
    expect(repeatSameEdition(doneStep)).toEqual({ ...copyStep, entryMethod: 'MANUAL' })
  })

  it('starts an existing work at translation selection', () => {
    expect(selectExistingWork({ workId: 'work-1', title: 'Book', entryMethod: 'MANUAL' })).toEqual({
      kind: 'translation',
      workId: 'work-1',
      title: 'Book',
      entryMethod: 'MANUAL',
    })
  })

  it('repeatSameEdition forces MANUAL even when the original copy was a BARCODE scan', () => {
    const scannedCopy = selectExistingEdition({
      workId: 'work-1',
      title: 'Book',
      editionId: 'edition-1',
      entryMethod: 'BARCODE',
    })
    const doneStep = completeAddBook(scannedCopy)

    expect(repeatSameEdition(doneStep)).toEqual({
      kind: 'copy',
      workId: 'work-1',
      title: 'Book',
      editionId: 'edition-1',
      entryMethod: 'MANUAL',
    })
  })
})
