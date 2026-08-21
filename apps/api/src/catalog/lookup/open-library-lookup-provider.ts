import { Injectable } from '@nestjs/common'
import type { BookLookupResult } from '@bookswap/shared'
import { BookLookupProviderError, type BookLookupProvider } from './book-lookup-provider'

const API_ROOT = 'https://openlibrary.org/api/books'

interface OpenLibraryAuthor {
  name?: string
}

interface OpenLibraryPublisher {
  name?: string
}

interface OpenLibraryCover {
  small?: string
  medium?: string
  large?: string
}

interface OpenLibraryBookRecord {
  key?: string
  title?: string
  authors?: OpenLibraryAuthor[]
  publish_date?: string
  publishers?: OpenLibraryPublisher[]
  cover?: OpenLibraryCover
}

/** Open Library повертає всі bibkeys одним об'єктом, ключ — `ISBN:<isbn>`. */
type OpenLibraryBooksResponse = Record<string, OpenLibraryBookRecord | undefined>

/** Перший рік у рядку виду «March 2003», «2003», «Jul 08, 2003». */
function extractYear(publishDate: string | undefined): number | undefined {
  if (publishDate === undefined) return undefined

  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(publishDate)

  return match === null ? undefined : Number(match[0])
}

/** `/books/OL123456M` → `OL123456M`. */
function externalIdFromKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined

  return key.split('/').pop()
}

/**
 * R1: Open Library — без ключа й без квоти.
 *
 * Books API (`jscmd=data`), а не `/isbn/{isbn}.json`: останній віддає авторів
 * лише посиланнями (`/authors/OL...A`) і вимагав би окремого запиту на кожного
 * — N+1 замість одного виклику. Books API одразу вкладає імена авторів,
 * видавця й обкладинку в саму відповідь.
 *
 * Невідомий ISBN — це НЕ HTTP 404: провайдер відповідає 200 з порожнім
 * об'єктом, якщо для запитаного bibkey немає запису. Це і є єдина ознака
 * «не знайдено» для цього API.
 */
@Injectable()
export class OpenLibraryLookupProvider implements BookLookupProvider {
  async lookup(isbn: string, signal: AbortSignal): Promise<BookLookupResult | undefined> {
    const bibkey = `ISBN:${isbn}`
    const url = `${API_ROOT}?bibkeys=${bibkey}&format=json&jscmd=data`

    let response: Response

    try {
      response = await fetch(url, { signal })
    } catch (error) {
      throw new BookLookupProviderError(error instanceof Error ? error.message : 'мережева помилка')
    }

    if (!response.ok) {
      throw new BookLookupProviderError(`Open Library відповів HTTP ${String(response.status)}`)
    }

    const body = (await response.json().catch(() => undefined)) as
      OpenLibraryBooksResponse | undefined

    if (body === undefined) {
      throw new BookLookupProviderError('Open Library повернув тіло, що не є JSON')
    }

    const record = body[bibkey]

    if (record === undefined) return undefined

    if (record.title === undefined || record.title.trim() === '') {
      throw new BookLookupProviderError('Open Library повернув запис без назви')
    }

    const authors = (record.authors ?? [])
      .map((author) => author.name)
      .filter((name): name is string => typeof name === 'string' && name.trim() !== '')

    const publisher = record.publishers?.[0]?.name
    const coverUrl = record.cover?.large ?? record.cover?.medium ?? record.cover?.small
    const publishedYear = extractYear(record.publish_date)
    const externalId = externalIdFromKey(record.key)

    return {
      title: record.title,
      ...(authors.length > 0 ? { authors } : {}),
      ...(publishedYear === undefined ? {} : { publishedYear }),
      ...(publisher === undefined ? {} : { publisher }),
      ...(coverUrl === undefined ? {} : { coverUrl }),
      ...(externalId === undefined ? {} : { externalId }),
    }
  }
}
