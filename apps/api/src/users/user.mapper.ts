import type { Me, PublicUser } from '@bookswap/shared'
import type { UserModel } from '../generated/prisma/models'

/**
 * Проєкції користувача назовні (§9).
 *
 * Перелік полів явний, а не `...user` із видаленням зайвого: при такому підході
 * кожне нове поле моделі — від `passwordHash` до `telegramChatId` — потрапляє в
 * API мовчки, і помітять це вже після витоку.
 */

/** Власнику — повний профіль. */
export function toMe(user: UserModel): Me {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    libraryVisibility: user.libraryVisibility,
    showHolderNames: user.showHolderNames,
    createdAt: user.createdAt.toISOString(),
  }
}

/**
 * §9-проєкція «Інший» на рівні `select`.
 *
 * Обмеження стоїть уже в запиті, а не лише в мапері: зайві поля не мають доїжджати
 * навіть до процесу. Живе поряд із `toPublicUser`, бо це дві половини однієї
 * гарантії, і розʼїхатися вони не мають права.
 */
export const PUBLIC_USER_FIELDS = { id: true, displayName: true, avatarUrl: true } as const

/** §9: «Профіль | Інший | імʼя + аватар». Ні пошти, ні налаштувань видимості. */
export function toPublicUser(
  user: Pick<UserModel, 'id' | 'displayName' | 'avatarUrl'>,
): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
}
