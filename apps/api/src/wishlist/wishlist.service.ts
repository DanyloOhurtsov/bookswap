import { Injectable } from '@nestjs/common'
import { type WishlistItemResponse, type WishlistResponse } from '@bookswap/shared'
import { CanonicalWorkService } from '../catalog/canonical/canonical-work.service'
import { isUniqueViolation } from '../common/prisma-errors'
import { PrismaService } from '../prisma/prisma.service'
import { toWishlistItem } from './wishlist.mapper'

/** Проєкція, яку читає `wishlist.mapper` — той самий набір, що й у пошуку кандидатів. */
const WITH_WORK = {
  work: { include: { authors: { include: { author: true } } } },
} as const

/**
 * §6.5 і §8, підетап 7e.
 *
 * Вішлист адресує `Work` (§3): «хочу прочитати» не залежить від конкретного
 * видання, яке зрештою трапиться в когось із друзів.
 */
@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonical: CanonicalWorkService,
  ) {}

  async list(userId: string): Promise<WishlistResponse> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      include: WITH_WORK,
      orderBy: { createdAt: 'desc' },
    })

    return { items: rows.map(toWishlistItem) }
  }

  /**
   * Ідемпотентно: повторне додавання того самого твору не падає й не створює
   * дублікат — унікальний індекс `(userId, workId)` це й так гарантує, а тут
   * лише перетворюється race/повтор на звичайну успішну відповідь замість 500.
   *
   * Порушення ловиться зовні `create`, а не запобігається попереднім `findFirst`:
   * дві одночасні спроби додати те саме мають сходитись до одного стану, а не
   * до «хто встиг перевірити першим».
   */
  async add(userId: string, workId: string): Promise<WishlistItemResponse> {
    await this.canonical.assertCanonical(workId)

    try {
      const row = await this.prisma.wishlistItem.create({
        data: { userId, workId },
        include: WITH_WORK,
      })

      return { item: toWishlistItem(row) }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error

      const existing = await this.prisma.wishlistItem.findUnique({
        where: { userId_workId: { userId, workId } },
        include: WITH_WORK,
      })

      // Одночасне видалення між `create` і повторним читанням — вкрай
      // малоймовірна гонка гонки; далі ретраїти нема сенсу, тож помилка йде
      // нагору такою, якою була.
      if (existing === null) throw error

      return { item: toWishlistItem(existing) }
    }
  }

  /** Ідемпотентно: відсутній рядок — не помилка, а вже досягнутий бажаний стан. */
  async remove(userId: string, workId: string): Promise<void> {
    // Stage 7h. A merged work is refused here too, and that does not contradict
    // the idempotence above: "no such row" and "the row moved" are different
    // states. The merge carried this user's item over to the canonical work, so
    // a delete by the old id would report success while the item stayed in the
    // list — the one outcome the caller must not be told.
    await this.canonical.assertCanonical(workId)

    await this.prisma.wishlistItem.deleteMany({ where: { userId, workId } })
  }
}
