import type { WishlistItem } from '@bookswap/shared'
import { toWork, toWorkAuthors, type WorkAuthorRow, type WorkRow } from '../catalog/catalog.mapper'
import type { WishlistItemModel } from '../generated/prisma/models'

/**
 * Чиста проєкція Prisma → контракт, як `catalog.mapper` і `library.mapper`:
 * без Nest і без клієнта, тож покривається unit-тестом без PostgreSQL.
 */
export type WishlistItemRow = Pick<WishlistItemModel, 'id' | 'workId' | 'createdAt'> & {
  work: WorkRow & { authors: WorkAuthorRow[] }
}

export function toWishlistItem(row: WishlistItemRow): WishlistItem {
  return {
    id: row.id,
    workId: row.workId,
    work: toWork(row.work),
    authors: toWorkAuthors(row.work.authors),
    createdAt: row.createdAt.toISOString(),
  }
}
