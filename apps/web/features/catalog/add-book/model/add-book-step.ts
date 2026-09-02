import type { AuthorRole, BookLookupResult, Translation } from '@bookswap/shared'

export interface AuthorEntry {
  key: string
  name: string
  /** Set only after an explicit selection, never from a name match. */
  authorId?: string
  role: AuthorRole
}

type SearchStep = { kind: 'search' }

type WorkStep = {
  kind: 'work'
  initialTitle: string
  isbn?: string
  lookup?: BookLookupResult
}

type CatalogContext = {
  workId: string
  title: string
  isbn?: string
  lookup?: BookLookupResult
}

type TranslationStep = CatalogContext & {
  kind: 'translation'
  /** Only populated when the user selected an existing work. */
  existingTranslations?: Translation[]
}

type EditionStep = CatalogContext & {
  kind: 'edition'
  translationId: string | null
}

type CopyStep = {
  kind: 'copy'
  workId: string
  title: string
  editionId: string
}

type DoneStep = { kind: 'done'; workId: string; title: string }

export type AddBookStep =
  SearchStep | WorkStep | TranslationStep | EditionStep | CopyStep | DoneStep

type NewWorkInput = Omit<WorkStep, 'kind'>
type ExistingWorkInput = Omit<TranslationStep, 'kind'>
type ExistingEditionInput = Omit<CopyStep, 'kind'>
type CreatedWork = Pick<TranslationStep, 'workId' | 'title'>

export function createSearchStep(): SearchStep {
  return { kind: 'search' }
}

export function startNewWork(input: NewWorkInput): WorkStep {
  return { kind: 'work', ...input }
}

export function selectExistingWork(input: ExistingWorkInput): TranslationStep {
  return { kind: 'translation', ...input }
}

export function selectExistingEdition(input: ExistingEditionInput): CopyStep {
  return { kind: 'copy', ...input }
}

export function continueAfterWork(step: WorkStep, created: CreatedWork): TranslationStep {
  return {
    kind: 'translation',
    ...created,
    ...(step.isbn === undefined ? {} : { isbn: step.isbn }),
    ...(step.lookup === undefined ? {} : { lookup: step.lookup }),
  }
}

export function continueAfterTranslation(
  step: TranslationStep,
  translationId: string | null,
): EditionStep {
  return {
    kind: 'edition',
    workId: step.workId,
    title: step.title,
    translationId,
    ...(step.isbn === undefined ? {} : { isbn: step.isbn }),
    ...(step.lookup === undefined ? {} : { lookup: step.lookup }),
  }
}

export function continueAfterEdition(step: EditionStep, editionId: string): CopyStep {
  return { kind: 'copy', workId: step.workId, title: step.title, editionId }
}

export function completeAddBook(step: CopyStep): DoneStep {
  return { kind: 'done', workId: step.workId, title: step.title }
}
