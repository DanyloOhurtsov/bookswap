import { Injectable } from '@nestjs/common'
import {
  USER_SEARCH_LIMIT,
  type Me,
  type PublicUser,
  type UpdateProfileRequest,
} from '@bookswap/shared'
import { PrismaService } from '../prisma/prisma.service'
import { toMe, toPublicUser } from './user.mapper'

/** §9: стороннім видно лише імʼя та аватар — вибірка обмежена вже на рівні запиту. */
const PUBLIC_FIELDS = { id: true, displayName: true, avatarUrl: true } as const

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, changes: UpdateProfileRequest): Promise<Me> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: changes })

    return toMe(user)
  }

  /**
   * Пошук за імʼям — частковий збіг без урахування регістру (§6.1).
   *
   * `contains`, а не тріграмна схожість: GIN-індекси §4.9 стоять на каталозі, і
   * заводити нечіткий пошук по людях, поки їх десятки, — вирішувати неіснуючу
   * проблему. Ліміт при цьому є, і він той самий, що бачить фронт.
   */
  async searchByDisplayName(query: string, viewerId: string): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({
      where: {
        displayName: { contains: query, mode: 'insensitive' },
        // Себе в результатах пошуку людей немає: додати себе в друзі не можна,
        // а рядок у видачі лише плутає.
        id: { not: viewerId },
      },
      select: PUBLIC_FIELDS,
      orderBy: { displayName: 'asc' },
      take: USER_SEARCH_LIMIT,
    })

    return users.map(toPublicUser)
  }

  /**
   * Пошук за поштою — тільки точний збіг (§6.1).
   *
   * Порожній результат і знайдений користувач відрізняються, і це свідомо: інакше
   * неможливо додати в друзі того, чию адресу тобі дали. Але підбирати адресу по
   * частинах не можна — саме тому тут немає ні `contains`, ні `startsWith`.
   */
  async findByExactEmail(email: string, viewerId: string): Promise<PublicUser[]> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: PUBLIC_FIELDS })

    if (user === null || user.id === viewerId) return []

    return [toPublicUser(user)]
  }
}
