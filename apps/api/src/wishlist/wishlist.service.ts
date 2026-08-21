import { HttpStatus, Injectable } from '@nestjs/common'
import { API_ERROR_CODES, type WishlistItemResponse, type WishlistResponse } from '@bookswap/shared'
import { ApiException } from '../common/api.exception'
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
  constructor(private readonly prisma: PrismaService) {}

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
    await this.assertWorkExists(workId)

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
    await this.prisma.wishlistItem.deleteMany({ where: { userId, workId } })
  }

  /**
   * Змержений твір (`mergedIntoId != null`) не рахується ціллю — той самий
   * інваріант, що й у пошуку кандидатів (Етап 7c): R4 переносить розв'язання
   * канонічності на Етап 7h, а до нього змержений твір просто не існує як ціль.
   */
  private async assertWorkExists(workId: string): Promise<void> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, mergedIntoId: true },
    })

    if (work === null || work.mergedIntoId !== null) {
      throw new ApiException(API_ERROR_CODES.NOT_FOUND, 'Твір не знайдено', HttpStatus.NOT_FOUND)
    }
  }
}
