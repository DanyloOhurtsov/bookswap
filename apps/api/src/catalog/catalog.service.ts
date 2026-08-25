import { HttpStatus, Injectable } from '@nestjs/common'
import {
  API_ERROR_CODES,
  CATALOG_SEARCH_LIMIT,
  isValidIsbn13,
  normalizeIsbn13,
  type AuthorMatch,
  type AuthorRole,
  type CatalogMatchKind,
  type CatalogSearchResponse,
  type CatalogSearchResult,
  type CreateEditionRequest,
  type CreateTranslationRequest,
  type CreateWorkRequest,
  type EditionDetailResponse,
  type EditionResponse,
  type TranslationListResponse,
  type TranslationResponse,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { ApiException } from '../common/api.exception'
import { isUniqueViolation } from '../common/prisma-errors'
import { PrismaService } from '../prisma/prisma.service'
import { CanonicalWorkService, workMergedConflict } from './canonical/canonical-work.service'
import { byEditionOrder, toEdition, toTranslation, toWork, toWorkAuthors } from './catalog.mapper'
import { pinSimilarityThreshold, rankAuthors, rankWorks } from './catalog.search'
import { escapeLikePattern } from './search-text'
import { TextNormalizer } from './text-normalizer'

/** Проєкції, які повторюються в кількох запитах. Один опис — одна форма даних. */
const WITH_AUTHORS = {
  authors: { include: { author: true } },
} as const

const WITH_EDITIONS = {
  editions: { include: { translation: true } },
} as const

/**
 * Каталог (§6.3): спільні метадані `Work → Translation → Edition`.
 *
 * Примірників тут немає взагалі — ні в запитах, ні у відповідях. Каталог
 * однаковий для всіх, а хто чим володіє, живе в `LibraryService` і проходить
 * крізь матрицю §9. Змішати їх означало б віддавати чужі полиці з ендпоінта, у
 * якого немає поняття «хто питає».
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizer: TextNormalizer,
    private readonly canonical: CanonicalWorkService,
  ) {}

  /**
   * §6.3, крок 1–2: «вводить назву або ISBN» → «Можливо, це одна з цих?».
   *
   * ISBN обробляється окремою гілкою й точним збігом: номер або той самий, або
   * ні, і «схожий ISBN» — це не схожа книжка, а інша книжка. Зовнішнього API тут
   * немає (§14.4) — шукаємо у власній базі.
   */
  async search(query: string): Promise<CatalogSearchResponse> {
    if (isValidIsbn13(query)) return this.searchByIsbn(normalizeIsbn13(query))

    const term = await this.normalizer.normalize(query)

    if (term === '') return { results: [], authorMatches: [] }

    const pattern = `%${escapeLikePattern(term)}%`

    // Обидва запити — в одній транзакції, бо поріг схожості фіксується саме на
    // транзакцію (`set_config(..., true)`).
    const ranked = await this.prisma.$transaction(async (tx) => {
      await pinSimilarityThreshold(tx)

      const works = await rankWorks(tx, term, pattern, CATALOG_SEARCH_LIMIT)
      const authors = await rankAuthors(tx, term, pattern, CATALOG_SEARCH_LIMIT)

      return { works, authors }
    })

    const matchKinds = new Map<string, CatalogMatchKind>(
      ranked.works.map((row) => [row.id, row.titleScore >= row.authorScore ? 'TITLE' : 'AUTHOR']),
    )

    return {
      results: await this.hydrateWorks(
        ranked.works.map((row) => row.id),
        (id) => matchKinds.get(id) ?? 'TITLE',
      ),
      authorMatches: await this.hydrateAuthors(ranked.authors.map((row) => row.id)),
    }
  }

  async getWork(workId: string): Promise<WorkDetailResponse> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      include: { ...WITH_AUTHORS, ...WITH_EDITIONS, translations: true },
    })

    if (work === null) throw notFound('Твір не знайдено')

    const editionsPerTranslation = countEditionsPerTranslation(work.editions)

    return {
      work: toWork(work),
      authors: toWorkAuthors(work.authors),
      translations: sortTranslations(work.translations).map((translation) =>
        toTranslation(translation, editionsPerTranslation.get(translation.id) ?? 0),
      ),
      editions: work.editions.map((edition) => toEdition(edition, work)).sort(byEditionOrder),
    }
  }

  /** §8: «впорядковані за score, з ознаками». Порядок задає сервер, не клієнт. */
  async listTranslations(workId: string): Promise<TranslationListResponse> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, translations: true, editions: { select: { translationId: true } } },
    })

    if (work === null) throw notFound('Твір не знайдено')

    const editionsPerTranslation = countEditionsPerTranslation(work.editions)

    return {
      translations: sortTranslations(work.translations).map((translation) =>
        toTranslation(translation, editionsPerTranslation.get(translation.id) ?? 0),
      ),
    }
  }

  async getEdition(editionId: string): Promise<EditionDetailResponse> {
    const edition = await this.prisma.edition.findUnique({
      where: { id: editionId },
      include: { translation: true, work: { include: WITH_AUTHORS } },
    })

    if (edition === null) throw notFound('Видання не знайдено')

    const editionCount = await this.prisma.edition.count({
      where: { translationId: edition.translationId },
    })

    return {
      edition: toEdition(edition, edition.work),
      work: toWork(edition.work),
      authors: toWorkAuthors(edition.work.authors),
      translation:
        edition.translation === null ? null : toTranslation(edition.translation, editionCount),
    }
  }

  /**
   * §6.3: метадані створює будь-хто автентифікований.
   *
   * Автор приходить або як `authorId` наявного, або як `name` нового — і ніколи
   * не підбирається за збігом імені. Тезки трапляються, і мовчки звести двох
   * людей в одну гірше, ніж лишити дублікат: дублікат видно й можна змерджити
   * (§6.3), а зрощені автори втрачають межу назавжди.
   */
  async createWork(userId: string, request: CreateWorkRequest): Promise<WorkDetailResponse> {
    const newNames = request.authors.flatMap((author) =>
      author.name === undefined ? [] : [author.name],
    )

    const workId = await this.prisma.$transaction(async (tx) => {
      const [titleNorm, ...nameNorms] = await this.normalizer.normalizeMany(
        [request.title, ...newNames],
        tx,
      )

      if (titleNorm === undefined) throw new Error('Нормалізація назви не повернула значення')

      await this.assertAuthorsExist(request.authors, tx)

      const work = await tx.work.create({
        data: {
          title: request.title,
          titleNorm,
          origLang: request.origLang,
          firstPubYear: request.firstPubYear ?? null,
          description: request.description ?? null,
          createdById: userId,
        },
      })

      let nextName = 0
      const links: { authorId: string; role: AuthorRole }[] = []

      for (const author of request.authors) {
        const role = author.role ?? 'AUTHOR'

        if (author.authorId !== undefined) {
          links.push({ authorId: author.authorId, role })
          continue
        }

        const nameNorm = nameNorms[nextName]

        nextName += 1

        if (author.name === undefined || nameNorm === undefined) {
          throw new Error('Нормалізація імені автора не повернула значення')
        }

        const created = await tx.author.create({
          data: { name: author.name, nameNorm, nameLatin: author.nameLatin ?? null },
        })

        links.push({ authorId: created.id, role })
      }

      // `skipDuplicates`: та сама людина в тій самій ролі двічі — це помилка
      // заповнення форми, а не привід відхилити весь твір.
      await tx.workAuthor.createMany({
        data: links.map((link) => ({ workId: work.id, ...link })),
        skipDuplicates: true,
      })

      return work.id
    })

    return this.getWork(workId)
  }

  async createTranslation(
    workId: string,
    request: CreateTranslationRequest,
  ): Promise<TranslationResponse> {
    await this.canonical.assertCanonical(workId)

    const translation = await this.prisma.translation.create({
      data: {
        workId,
        translator: request.translator,
        lang: request.lang,
        sourceLang: request.sourceLang,
        year: request.year ?? null,
        isAbridged: request.isAbridged ?? false,
        hasNotes: request.hasNotes ?? false,
        notes: request.notes ?? null,
      },
    })

    return { translation: toTranslation(translation, 0) }
  }

  async createEdition(
    userId: string,
    workId: string,
    request: CreateEditionRequest,
  ): Promise<EditionResponse> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, origLang: true, mergedIntoId: true },
    })

    if (work === null) throw notFound('Твір не знайдено')

    // Stage 7h: `mergedIntoId` is read here rather than through
    // `CanonicalWorkService.assertCanonical` only to avoid a second lookup —
    // `origLang` is needed anyway. The rule and its reasoning live there.
    if (work.mergedIntoId !== null) {
      throw workMergedConflict({
        workId: work.mergedIntoId,
        requestedWorkId: workId,
        moved: true,
      })
    }

    const translationId = request.translationId ?? null

    if (translationId !== null) {
      const translation = await this.prisma.translation.findUnique({
        where: { id: translationId },
        select: { workId: true },
      })

      // Переклад чужого твору — не «не знайдено», а неможлива комбінація:
      // `Edition` посилається і на твір, і на переклад, і вони мусять збігатися.
      if (translation === null || translation.workId !== workId) {
        throw new ApiException(
          API_ERROR_CODES.VALIDATION_ERROR,
          'Переклад не належить цьому твору',
          HttpStatus.BAD_REQUEST,
        )
      }
    }

    try {
      const edition = await this.prisma.edition.create({
        data: {
          workId,
          translationId,
          publisher: request.publisher ?? null,
          year: request.year ?? null,
          isbn13: request.isbn13 ?? null,
          pageCount: request.pageCount ?? null,
          coverUrl: request.coverUrl ?? null,
          format: request.format ?? 'PAPERBACK',
          createdById: userId,
        },
        include: { translation: true },
      })

      return { edition: toEdition(edition, work) }
    } catch (error) {
      if (isUniqueViolation(error) && request.isbn13 !== undefined && request.isbn13 !== null) {
        throw await this.isbnTaken(request.isbn13)
      }

      throw error
    }
  }

  private async searchByIsbn(isbn13: string): Promise<CatalogSearchResponse> {
    const edition = await this.prisma.edition.findUnique({
      where: { isbn13 },
      select: { workId: true },
    })

    return {
      results: edition === null ? [] : await this.hydrateWorks([edition.workId], () => 'ISBN'),
      authorMatches: [],
    }
  }

  /**
   * Ранжування віддає лише id — самі записи читаються типізовано.
   *
   * Порядок відновлюється за списком id, а не за тим, у якому їх повернув
   * `findMany`: `IN (...)` порядку не гарантує, і без цього кроку ранжування
   * пошуку просто зникало б.
   */
  private async hydrateWorks(
    ids: string[],
    matchedOn: (id: string) => CatalogMatchKind,
  ): Promise<CatalogSearchResult[]> {
    if (ids.length === 0) return []

    // `mergedIntoId: null` — DoD 7h: a merged work is never a search hit of its
    // own. `rankWorks` already filters it out; the ISBN branch reaches this
    // method through `Edition.workId`, which cannot belong to a merged work
    // either (writes are refused, and the merge moves editions along). Repeating
    // the condition here keeps the guarantee local to the query that returns
    // the rows, exactly as `SearchCandidatesService.hydrate` does.
    const works = await this.prisma.work.findMany({
      where: { id: { in: ids }, mergedIntoId: null },
      include: { ...WITH_AUTHORS, ...WITH_EDITIONS },
    })

    const byId = new Map(works.map((work) => [work.id, work]))

    return ids.flatMap((id) => {
      const work = byId.get(id)

      if (work === undefined) return []

      return [
        {
          work: toWork(work),
          authors: toWorkAuthors(work.authors),
          editions: work.editions.map((edition) => toEdition(edition, work)).sort(byEditionOrder),
          matchedOn: matchedOn(id),
        },
      ]
    })
  }

  private async hydrateAuthors(ids: string[]): Promise<AuthorMatch[]> {
    if (ids.length === 0) return []

    const authors = await this.prisma.author.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        nameLatin: true,
        // DoD 7h: merged works are not separate entries anywhere in the output,
        // and a count is an entry too. The merge does NOT move `WorkAuthor`
        // rows, so without this filter an author linked to both the duplicate
        // and the canonical work is credited with two books instead of one.
        works: { where: { work: { mergedIntoId: null } }, select: { workId: true } },
      },
    })

    const byId = new Map(authors.map((author) => [author.id, author]))

    return ids.flatMap((id) => {
      const author = byId.get(id)

      if (author === undefined) return []

      return [
        {
          id: author.id,
          name: author.name,
          nameLatin: author.nameLatin,
          // Через `Set`, а не `_count`: одна людина може бути в одного твору і
          // автором, і ілюстратором — це два рядки `WorkAuthor`, але один твір.
          workCount: new Set(author.works.map((link) => link.workId)).size,
        },
      ]
    })
  }

  private async assertAuthorsExist(
    authors: CreateWorkRequest['authors'],
    tx: Pick<PrismaService, 'author'>,
  ): Promise<void> {
    const ids = [
      ...new Set(
        authors.flatMap((author) => (author.authorId === undefined ? [] : [author.authorId])),
      ),
    ]

    if (ids.length === 0) return

    const found = await tx.author.count({ where: { id: { in: ids } } })

    if (found !== ids.length) throw notFound('Автора не знайдено')
  }

  /**
   * §8 вимагає машиночитний код, а тут ще й id зайнятого видання: клієнту
   * потрібна не помилка, а дорога до наявного запису, де лишається створити
   * тільки `Copy` (§6.3, крок 3).
   */
  private async isbnTaken(isbn13: string): Promise<ApiException> {
    const existing = await this.prisma.edition.findUnique({
      where: { isbn13 },
      select: { id: true },
    })

    return new ApiException(
      API_ERROR_CODES.EDITION_ISBN_TAKEN,
      'Видання з таким ISBN уже є в каталозі',
      HttpStatus.CONFLICT,
      existing === null ? undefined : { editionId: existing.id },
    )
  }
}

/**
 * §8: «впорядковані за score». `score` рахується §10 на етапі оцінок і поки
 * всюди нуль, тож другий ключ не косметика — без нього порядок був би довільним.
 */
function sortTranslations<T extends { score: number; year: number | null; id: string }>(
  translations: T[],
): T[] {
  return [...translations].sort(
    (one, other) =>
      other.score - one.score ||
      (one.year ?? Number.MAX_SAFE_INTEGER) - (other.year ?? Number.MAX_SAFE_INTEGER) ||
      one.id.localeCompare(other.id),
  )
}

/** §10.3: кількість видань цього перекладу — непрямий сигнал якості. */
function countEditionsPerTranslation(
  editions: { translationId: string | null }[],
): Map<string, number> {
  const counts = new Map<string, number>()

  for (const edition of editions) {
    if (edition.translationId === null) continue

    counts.set(edition.translationId, (counts.get(edition.translationId) ?? 0) + 1)
  }

  return counts
}

function notFound(message: string): ApiException {
  return new ApiException(API_ERROR_CODES.NOT_FOUND, message, HttpStatus.NOT_FOUND)
}
