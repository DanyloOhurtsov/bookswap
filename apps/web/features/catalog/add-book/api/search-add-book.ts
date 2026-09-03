import {
  bookLookupResponseSchema,
  isValidIsbn13,
  normalizeIsbn13,
  searchCandidatesRequestSchema,
  searchCandidatesResponseSchema,
  type BookLookupResult,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { apiRequest } from '@/app/lib/api'

type LookupOutcome = {
  lookup?: BookLookupResult
  lookupFailure?: unknown
}

export type AddBookSearchResult = LookupOutcome & {
  query: string
  candidates: WorkDetailResponse[]
  isbn?: string
}

async function requestLookup(isbn: string | undefined): Promise<LookupOutcome> {
  if (isbn === undefined) return {}

  try {
    const response = await apiRequest(`/catalog/lookup?isbn=${encodeURIComponent(isbn)}`, {
      schema: bookLookupResponseSchema,
    })

    return { lookup: response.result }
  } catch (error) {
    // Lookup only suggests editable defaults; candidate search remains authoritative.
    return { lookupFailure: error }
  }
}

/** Runs catalog matching and optional ISBN enrichment as independent parallel requests. */
export async function searchAddBookCandidates(query: string): Promise<AddBookSearchResult> {
  const { q } = searchCandidatesRequestSchema.parse({ q: query })
  const isbn = isValidIsbn13(q) ? normalizeIsbn13(q) : undefined

  const [response, lookupOutcome] = await Promise.all([
    apiRequest(`/catalog/search/candidates?q=${encodeURIComponent(q)}`, {
      schema: searchCandidatesResponseSchema,
    }),
    requestLookup(isbn),
  ])

  return {
    query: q,
    candidates: response.candidates,
    ...(isbn === undefined ? {} : { isbn }),
    ...lookupOutcome,
  }
}
