import { z } from 'zod'
import { conditionSchema, copyStatusSchema, ownerCopyStatusSchema } from '../domain/copy'
import { languageCodeSchema } from '../domain/language'
import { visibilitySchema } from '../domain/visibility'
import { editionSchema, workAuthorSchema, workSchema } from './catalog'
import { publicUserSchema } from './user'

/**
 * §6.4–6.5 і §8, блок «Бібліотека».
 *
 * Три проєкції примірника, а не одна з опційними полями. Це не дублювання: вони
 * відповідають на різні питання — «моя книжка», «книжка друга, яку мені видно» і
 * «чужа книжка, що зараз у мене». §9 вимагає, щоб приватне не віддавалося з API,
 * а не ховалося в UI, і єдиний спосіб це гарантувати — щоб приватного поля просто
 * не існувало у відповідній схемі.
 */

export const LIBRARY_LIMITS = {
  noteMax: 1000,
  idMax: 64,
  queryMin: 2,
  queryMax: 200,
} as const

const idSchema = z.string().trim().min(1).max(LIBRARY_LIMITS.idMax)

const noteSchema = z.string().trim().max(LIBRARY_LIMITS.noteMax)

/**
 * Дата придбання — саме дата, без часу, в обидва боки.
 *
 * `acquiredAt` у базі — `DateTime`, але «о котрій годині ви купили книжку» не
 * означає нічого. Віддавати повний ISO означало б змусити форму його різати, а
 * потім гадати про часовий пояс: 2026-08-15T00:00Z у Києві — це вже 15 серпня
 * о третій ночі, і при зворотному перетворенні дата стрибнула б на день.
 */
const acquiredAtSchema = z.iso.date()

// --- Проєкції примірника ------------------------------------------------------

/** Власний примірник: видно все, включно з приватною нотаткою. */
export const ownCopySchema = z.object({
  id: z.string(),
  status: copyStatusSchema,
  visibility: visibilitySchema,
  condition: conditionSchema,
  note: z.string().nullable(),
  acquiredAt: acquiredAtSchema.nullable(),
  createdAt: z.iso.datetime(),
  /** `currentHolderId === ownerId` — інваріант §5.3.2 в термінах інтерфейсу. */
  isHome: z.boolean(),
  /** Хто тримає, якщо не вдома. Власник бачить імена завжди (§6.6). */
  holder: publicUserSchema.nullable(),
})

export type OwnCopy = z.infer<typeof ownCopySchema>

/**
 * Примірник у бібліотеці іншої людини.
 *
 * Немає `note`, `acquiredAt` і `visibility` — це приватне власника. `holder`
 * зʼявляється лише коли `holderNamesVisibleTo` дозволив (§6.6); інакше лишається
 * `null`, і видно тільки статус.
 */
export const visibleCopySchema = z.object({
  id: z.string(),
  status: copyStatusSchema,
  condition: conditionSchema,
  isHome: z.boolean(),
  holder: publicUserSchema.nullable(),
})

export type VisibleCopy = z.infer<typeof visibleCopySchema>

/**
 * Чужий примірник, що зараз у мене (§6.4, «Чужі книжки в мене»).
 *
 * Власника видно завжди — інакше незрозуміло, кому повертати. Нотатки власника —
 * ні: те, що книжка в мене, не дає доступу до його записів про неї.
 */
export const borrowedCopySchema = z.object({
  id: z.string(),
  status: copyStatusSchema,
  condition: conditionSchema,
  owner: publicUserSchema,
})

export type BorrowedCopy = z.infer<typeof borrowedCopySchema>

// --- Групи --------------------------------------------------------------------

/**
 * §6.4: «Шантарам ×3 · 2 вдома, 1 у Марка».
 *
 * Групування за виданням — подання, а не модель: окремі `Copy` лишаються в
 * `copies` поштучно. Кількість — це `COUNT` рядків, а не поле `quantity` (§3).
 */
export const libraryCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  home: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
})

export type LibraryCounts = z.infer<typeof libraryCountsSchema>

export const libraryGroupSchema = z.object({
  edition: editionSchema,
  work: workSchema,
  authors: z.array(workAuthorSchema),
  copies: z.array(ownCopySchema),
  counts: libraryCountsSchema,
})

export type LibraryGroup = z.infer<typeof libraryGroupSchema>

/** Те саме для чужої бібліотеки. Лічильники рахують **лише видимі** примірники. */
export const visibleLibraryGroupSchema = z.object({
  edition: editionSchema,
  work: workSchema,
  authors: z.array(workAuthorSchema),
  copies: z.array(visibleCopySchema),
  counts: libraryCountsSchema,
})

export type VisibleLibraryGroup = z.infer<typeof visibleLibraryGroupSchema>

export const borrowedLibraryGroupSchema = z.object({
  edition: editionSchema,
  work: workSchema,
  authors: z.array(workAuthorSchema),
  copies: z.array(borrowedCopySchema),
  counts: libraryCountsSchema,
})

export type BorrowedLibraryGroup = z.infer<typeof borrowedLibraryGroupSchema>

// --- Запити -------------------------------------------------------------------

/**
 * §8: `?status=&lang=&q=`.
 *
 * `lang` — мова видання: `Translation.lang`, а для видання мовою оригіналу —
 * `Work.origLang`. Різниця не косметична: том англійською в оригіналі й том
 * англійського перекладу з японської — це різні речі на полиці.
 */
export const libraryQueryRequestSchema = z.object({
  status: copyStatusSchema.optional(),
  lang: languageCodeSchema.optional(),
  q: z.string().trim().min(LIBRARY_LIMITS.queryMin).max(LIBRARY_LIMITS.queryMax).optional(),
})

export type LibraryQueryRequest = z.infer<typeof libraryQueryRequestSchema>

/**
 * §8: `POST /me/library { editionId, condition, note, visibility }`.
 *
 * Кожен фізичний примірник — окремий рядок, тож поля «скільки» тут немає й бути
 * не може (§3). Два однакові томи — два запити.
 */
export const addCopyRequestSchema = z.object({
  editionId: idSchema,
  condition: conditionSchema.optional(),
  note: noteSchema.nullable().optional(),
  visibility: visibilitySchema.optional(),
  acquiredAt: acquiredAtSchema.nullable().optional(),
})

export type AddCopyRequest = z.infer<typeof addCopyRequestSchema>

/**
 * §6.4: редагування примірника.
 *
 * `status` звужений до `ownerCopyStatusSchema`: `RESERVED` і `LENT_OUT` виникають
 * лише з переходів §5.1, тож клієнт не може їх надіслати в принципі — вони
 * відпадають на валідації, а не на бізнес-перевірці. Решта полів не залежить від
 * стану лоану: нотатка про стан книжки потрібна власнику саме тоді, коли її
 * хтось тримає.
 */
export const updateCopyRequestSchema = z
  .object({
    condition: conditionSchema,
    note: noteSchema.nullable(),
    visibility: visibilitySchema,
    acquiredAt: acquiredAtSchema.nullable(),
    status: ownerCopyStatusSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Не передано жодного поля для зміни')

export type UpdateCopyRequest = z.infer<typeof updateCopyRequestSchema>

// --- Відповіді ----------------------------------------------------------------

export const libraryResponseSchema = z.object({
  groups: z.array(libraryGroupSchema),
})

export type LibraryResponse = z.infer<typeof libraryResponseSchema>

export const borrowedLibraryResponseSchema = z.object({
  groups: z.array(borrowedLibraryGroupSchema),
})

export type BorrowedLibraryResponse = z.infer<typeof borrowedLibraryResponseSchema>

/** Бібліотека іншої людини — разом із тим, чия вона (§9: імʼя + аватар видно всім). */
export const visibleLibraryResponseSchema = z.object({
  owner: publicUserSchema,
  groups: z.array(visibleLibraryGroupSchema),
})

export type VisibleLibraryResponse = z.infer<typeof visibleLibraryResponseSchema>

export const copyResponseSchema = z.object({
  copy: ownCopySchema,
})

export type CopyResponse = z.infer<typeof copyResponseSchema>
