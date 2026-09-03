import { z } from 'zod'
import { authorRoleSchema, editionFormatSchema } from '../domain/catalog'
import { isbn13Schema } from '../domain/isbn'
import { languageCodeSchema } from '../domain/language'

/**
 * §6.3 і §8, блок «Каталог».
 *
 * Чотири сутності ланцюга §3 лишаються чотирма й у контракті: `Work` не має полів
 * видання, `Edition` не має полів примірника. Спокуса злити їх в один «Book» — це
 * рівно та помилка, від якої застерігає §3.
 *
 * `Copy` тут немає взагалі: каталог — спільні метадані, а хто чим володіє, живе в
 * `contracts/library.ts` і проходить крізь матрицю §9.
 */

export const CATALOG_SEARCH_LIMIT = 20

/**
 * Обмеження полів каталогу. Ті самі числа потрібні `class-validator`-декораторам
 * у `apps/api` (§11 вимагає обидва механізми), тож живуть константами.
 */
export const CATALOG_LIMITS = {
  titleMax: 300,
  descriptionMax: 2000,
  authorNameMax: 200,
  translatorMax: 200,
  publisherMax: 200,
  notesMax: 1000,
  coverUrlMax: 2048,
  idMax: 64,
  pageCountMax: 20_000,
  authorsMax: 10,
  queryMin: 2,
  queryMax: 200,
  /** Найдавніші твори — до нашої ери; верхня межа лишає запас на анонси. */
  yearMin: -4000,
  yearMax: 2100,
} as const

const yearSchema = z.number().int().min(CATALOG_LIMITS.yearMin).max(CATALOG_LIMITS.yearMax)

const idSchema = z.string().trim().min(1).max(CATALOG_LIMITS.idMax)

// --- Проєкції ----------------------------------------------------------------

/**
 * Твір **без** авторів: вони йдуть окремим полем поруч, а не вкладеними в нього.
 *
 * Так однакову форму мають і пошук, і сторінка твору, і роль автора (`AuthorRole`
 * зі `WorkAuthor`) не доводиться вигадувати, куди подіти — вона властивість
 * звʼязку, а не людини.
 */
export const workSchema = z.object({
  id: z.string(),
  title: z.string(),
  origLang: z.string(),
  firstPubYear: z.number().int().nullable(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
})

export type Work = z.infer<typeof workSchema>

export const workAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameLatin: z.string().nullable(),
  role: authorRoleSchema,
})

export type WorkAuthor = z.infer<typeof workAuthorSchema>

/**
 * Переклад із фактичними ознаками §10.3 — тими, що заповнюються при додаванні
 * книжки й не залежать від чиєїсь думки.
 *
 * `score`, `ratingAvg`, `ratingCount` навмисно відсутні: без правила cold start
 * (§10.3) клієнт малював би «0.0» під кожним перекладом. Сортування за `score`
 * (§8) робить сервер — для нього поле в контракті не потрібне. Ранг приїде разом
 * зі §10 на етапі оцінок.
 */
export const translationSchema = z.object({
  id: z.string(),
  workId: z.string(),
  translator: z.string(),
  lang: z.string(),
  sourceLang: z.string(),
  year: z.number().int().nullable(),
  isAbridged: z.boolean(),
  hasNotes: z.boolean(),
  notes: z.string().nullable(),
  /** §10.3: «перевидають те, що продається» — непрямий сигнал якості. */
  editionCount: z.number().int().nonnegative(),
})

export type Translation = z.infer<typeof translationSchema>

/**
 * Видання. `lang` і `translator` — обчислені: для видання мовою оригіналу
 * (`translationId = null`) це `Work.origLang` і `null`.
 *
 * Рахує їх сервер, а не клієнт: інакше кожна сторінка, що показує видання,
 * повторювала б це «якщо переклад є — беремо з нього» і одного дня помилилася б.
 */
export const editionSchema = z.object({
  id: z.string(),
  workId: z.string(),
  translationId: z.string().nullable(),
  publisher: z.string().nullable(),
  year: z.number().int().nullable(),
  isbn13: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  format: editionFormatSchema,
  lang: z.string(),
  translator: z.string().nullable(),
})

export type Edition = z.infer<typeof editionSchema>

// --- Пошук -------------------------------------------------------------------

export const catalogSearchRequestSchema = z.object({
  q: z
    .string()
    .trim()
    .min(CATALOG_LIMITS.queryMin, 'Мінімум два символи')
    .max(CATALOG_LIMITS.queryMax),
})

export type CatalogSearchRequest = z.infer<typeof catalogSearchRequestSchema>

export const CATALOG_MATCH_KINDS = ['TITLE', 'AUTHOR', 'ISBN'] as const

export const catalogMatchKindSchema = z.enum(CATALOG_MATCH_KINDS)

export type CatalogMatchKind = z.infer<typeof catalogMatchKindSchema>

/**
 * §6.3, крок 2: «Можливо, це одна з цих?» — разом із виданнями.
 *
 * Видання приїжджають одразу, бо саме на них людина впізнає своє: «КСД, 2019» їй
 * каже більше, ніж назва твору. Без них крок 3 («знайшов своє видання →
 * створюється лише Copy») вимагав би ще одного запиту на кожен показаний твір.
 */
export const catalogSearchResultSchema = z.object({
  work: workSchema,
  authors: z.array(workAuthorSchema),
  editions: z.array(editionSchema),
  matchedOn: catalogMatchKindSchema,
})

export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>

/**
 * Знайдені автори — окремо від творів.
 *
 * Пошук і так рахує схожість за іменем автора (§8: «fuzzy-пошук по Work +
 * Author»), тож віддати самих авторів нічого не коштує. Живить це крок майстра
 * «виберіть наявного автора або створіть нового»: автоматично переюзати автора за
 * збігом імені не можна — тезки бувають.
 */
export const authorMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameLatin: z.string().nullable(),
  workCount: z.number().int().nonnegative(),
})

export type AuthorMatch = z.infer<typeof authorMatchSchema>

export const catalogSearchResponseSchema = z.object({
  results: z.array(catalogSearchResultSchema).max(CATALOG_SEARCH_LIMIT),
  authorMatches: z.array(authorMatchSchema).max(CATALOG_SEARCH_LIMIT),
})

export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>

// --- Читання -----------------------------------------------------------------

export const workDetailResponseSchema = z.object({
  work: workSchema,
  authors: z.array(workAuthorSchema),
  translations: z.array(translationSchema),
  editions: z.array(editionSchema),
})

export type WorkDetailResponse = z.infer<typeof workDetailResponseSchema>

/** §8: «впорядковані за score, з ознаками». Порядок задає сервер. */
export const translationListResponseSchema = z.object({
  translations: z.array(translationSchema),
})

export type TranslationListResponse = z.infer<typeof translationListResponseSchema>

export const editionDetailResponseSchema = z.object({
  edition: editionSchema,
  work: workSchema,
  authors: z.array(workAuthorSchema),
  translation: translationSchema.nullable(),
})

export type EditionDetailResponse = z.infer<typeof editionDetailResponseSchema>

// --- Canonical resolution after a merge (§6.3; stage 7h) ---------------------

/**
 * The `details` payload that rides along with `WORK_MERGED`.
 *
 * Reads carry it in the body of the 301, writes in the body of the 409, and it
 * is the same shape either way: the client needs the same two facts in both
 * cases — which work it asked for, and which one answers for it now.
 *
 * Resolution is exactly one hop deep, so `canonicalWorkId` is never itself
 * merged. That is invariant R4, held by `merge.service.ts`: a merge whose source
 * or target is already merged is refused, and every incoming `mergedIntoId` is
 * repointed at the new target.
 */
export const workMergedDetailsSchema = z.object({
  canonicalWorkId: z.string(),
  requestedWorkId: z.string(),
})

export type WorkMergedDetails = z.infer<typeof workMergedDetailsSchema>

// --- Кандидати для дедуплікації (§6.3, крок 2; Етап 7c) ----------------------

/**
 * Скільки кандидатів показати перед створенням нового `Work`/`Edition`.
 *
 * Це підказка «може, така книжка вже є», а не список для гортання — тому
 * пагінації свідомо немає: якщо серед перших {@link SEARCH_CANDIDATES_LIMIT}
 * нічого не підійшло, людина створює нове, а не гортає сторінки в пошуках
 * дубліката.
 */
export const SEARCH_CANDIDATES_LIMIT = 10

export const searchCandidatesRequestSchema = catalogSearchRequestSchema

export type SearchCandidatesRequest = z.infer<typeof searchCandidatesRequestSchema>

/**
 * Кожен кандидат — це `WorkDetailResponse`: та сама форма, що й у `GET
 * /works/:id`, з усіма `Edition` і `Translation` твору. Людина впізнає своє
 * видання за видавництвом і роком так само, як на сторінці твору.
 */
export const searchCandidatesResponseSchema = z.object({
  candidates: z.array(workDetailResponseSchema).max(SEARCH_CANDIDATES_LIMIT),
})

export type SearchCandidatesResponse = z.infer<typeof searchCandidatesResponseSchema>

// --- Створення ---------------------------------------------------------------

/**
 * Автор твору: **або** id наявного, **або** імʼя нового. Рівно одне з двох.
 *
 * Автодедуп «є автор із таким іменем — беремо його» тут заборонений: тезки
 * трапляються, і мовчки звести двох людей в одну — гірше, ніж завести дублікат
 * (його хоч видно й можна змерджити, §6.3).
 */
export const workAuthorInputSchema = z
  .object({
    authorId: idSchema.optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Не вказано імʼя автора')
      .max(CATALOG_LIMITS.authorNameMax)
      .optional(),
    nameLatin: z.string().trim().min(1).max(CATALOG_LIMITS.authorNameMax).nullable().optional(),
    role: authorRoleSchema.optional(),
  })
  .refine(
    (value) => (value.authorId === undefined) !== (value.name === undefined),
    'Потрібен або authorId наявного автора, або name нового — рівно одне з двох',
  )

export type WorkAuthorInput = z.infer<typeof workAuthorInputSchema>

export const createWorkRequestSchema = z.object({
  title: z.string().trim().min(1, 'Не вказано назву').max(CATALOG_LIMITS.titleMax),
  origLang: languageCodeSchema,
  firstPubYear: yearSchema.nullable().optional(),
  description: z.string().trim().max(CATALOG_LIMITS.descriptionMax).nullable().optional(),
  // Хоча б один автор: твір без автора не знайдеться пошуком по автору (§8) і
  // не дасть §10 жодного сигналу.
  authors: z
    .array(workAuthorInputSchema)
    .min(1, 'Потрібен хоча б один автор')
    .max(CATALOG_LIMITS.authorsMax),
})

export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>

export const createTranslationRequestSchema = z.object({
  translator: z.string().trim().min(1, 'Не вказано перекладача').max(CATALOG_LIMITS.translatorMax),
  lang: languageCodeSchema,
  /** §10.3: з якої мови перекладали — найсильніший сигнал при cold start. */
  sourceLang: languageCodeSchema,
  year: yearSchema.nullable().optional(),
  isAbridged: z.boolean().optional(),
  hasNotes: z.boolean().optional(),
  notes: z.string().trim().max(CATALOG_LIMITS.notesMax).nullable().optional(),
})

export type CreateTranslationRequest = z.infer<typeof createTranslationRequestSchema>

export const translationResponseSchema = z.object({
  translation: translationSchema,
})

export type TranslationResponse = z.infer<typeof translationResponseSchema>

/** `translationId: null` — видання мовою оригіналу (§4.4). */
export const createEditionRequestSchema = z.object({
  translationId: idSchema.nullable().optional(),
  publisher: z.string().trim().min(1).max(CATALOG_LIMITS.publisherMax).nullable().optional(),
  year: yearSchema.nullable().optional(),
  isbn13: isbn13Schema.nullable().optional(),
  pageCount: z.number().int().min(1).max(CATALOG_LIMITS.pageCountMax).nullable().optional(),
  coverUrl: z.url('Некоректне посилання').max(CATALOG_LIMITS.coverUrlMax).nullable().optional(),
  format: editionFormatSchema.optional(),
})

export type CreateEditionRequest = z.infer<typeof createEditionRequestSchema>

export const editionResponseSchema = z.object({
  edition: editionSchema,
})

export type EditionResponse = z.infer<typeof editionResponseSchema>
