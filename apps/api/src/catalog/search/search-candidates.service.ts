import { Injectable } from '@nestjs/common'
import {
  isValidIsbn13,
  normalizeIsbn13,
  SEARCH_CANDIDATES_LIMIT,
  type SearchCandidatesResponse,
  type WorkDetailResponse,
} from '@bookswap/shared'
import { PrismaService } from '../../prisma/prisma.service'
import {
  byEditionOrder,
  toEdition,
  toTranslation,
  toWork,
  toWorkAuthors,
  type EditionRow,
} from '../catalog.mapper'
import { pinSimilarityThreshold, rankWorks } from '../catalog.search'
import { escapeLikePattern } from '../search-text'
import { TextNormalizer } from '../text-normalizer'

const WITH_CANDIDATE_RELATIONS = {
  authors: { include: { author: true } },
  editions: { include: { translation: true } },
  translations: true,
} as const

/**
 * Етап 7c: бекенд-пошук кандидатів перед створенням `Work`/`Edition` (§6.3,
 * крок 2) — «можливо, це одна з цих?».
 *
 * Ранжування за назвою й авторами навмисно те саме, що й у загальному
 * `/catalog/search` (`rankWorks`, `pinSimilarityThreshold`): другий шлях
 * пошуку в базі — це другий шанс розійтися з першим і мовчки не знайти
 * дублікат, якого перший знаходить. Відмінність цього ендпоінта — форма
 * відповіді (кандидат несе й `Translation`, не лише `Edition`) і те, що це
 * топ-N підказка, а не сторінка результатів (`SEARCH_CANDIDATES_LIMIT`, без
 * пагінації).
 */
@Injectable()
export class SearchCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizer: TextNormalizer,
  ) {}

  async search(query: string): Promise<SearchCandidatesResponse> {
    if (isValidIsbn13(query)) return this.searchByIsbn(normalizeIsbn13(query))

    const term = await this.normalizer.normalize(query)

    if (term === '') return { candidates: [] }

    const pattern = `%${escapeLikePattern(term)}%`

    // Той самий поріг фіксується на транзакцію, що й у загальному пошуку —
    // див. `pinSimilarityThreshold`.
    const ranked = await this.prisma.$transaction(async (tx) => {
      await pinSimilarityThreshold(tx)

      return rankWorks(tx, term, pattern, SEARCH_CANDIDATES_LIMIT)
    })

    return { candidates: await this.hydrate(ranked.map((row) => row.id)) }
  }

  /**
   * Точний збіг ISBN, якщо він є (§6.3, крок 1). Видання злитого твору
   * (`mergedIntoId != null`) не рахується збігом: R4 переносить розв'язання
   * канонічності на Етап 7h, а до нього змержений твір просто не кандидат.
   */
  private async searchByIsbn(isbn13: string): Promise<SearchCandidatesResponse> {
    const edition = await this.prisma.edition.findUnique({
      where: { isbn13 },
      select: { workId: true },
    })

    if (edition === null) return { candidates: [] }

    return { candidates: await this.hydrate([edition.workId]) }
  }

  /**
   * Порядок відновлюється за списком id, а не за тим, у якому їх повернув
   * `findMany` (`IN (...)` порядку не гарантує) — так само, як у загальному
   * пошуку. `mergedIntoId: null` у `where` прибирає змержені твори з видачі
   * (DoD 7c) для обох гілок одразу.
   */
  private async hydrate(workIds: string[]): Promise<WorkDetailResponse[]> {
    if (workIds.length === 0) return []

    const works = await this.prisma.work.findMany({
      where: { id: { in: workIds }, mergedIntoId: null },
      include: WITH_CANDIDATE_RELATIONS,
    })

    const byId = new Map(works.map((work) => [work.id, work]))

    return workIds.flatMap((id) => {
      const work = byId.get(id)

      if (work === undefined) return []

      const editionsPerTranslation = countEditionsPerTranslation(work.editions)

      return [
        {
          work: toWork(work),
          authors: toWorkAuthors(work.authors),
          translations: work.translations.map((translation) =>
            toTranslation(translation, editionsPerTranslation.get(translation.id) ?? 0),
          ),
          editions: work.editions.map((edition) => toEdition(edition, work)).sort(byEditionOrder),
        },
      ]
    })
  }
}

/** Та сама лічба, що й у `CatalogService.getWork` — скільки видань має переклад. */
function countEditionsPerTranslation(editions: EditionRow[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const edition of editions) {
    if (edition.translationId === null) continue

    counts.set(edition.translationId, (counts.get(edition.translationId) ?? 0) + 1)
  }

  return counts
}
