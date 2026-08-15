import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SESSION_TTL_MS } from './auth.constants'
import { generateToken, hashToken } from './tokens'
import type { UserModel } from '../generated/prisma/models'

/**
 * Мінімум, потрібний для запису сесій. Під нього підходить і `PrismaService`, і
 * транзакційний клієнт із `$transaction` — типізувати останній інакше означало б
 * тягнути сюди внутрішні типи згенерованого клієнта.
 */
type SessionWriter = Pick<PrismaService, 'session'>

/**
 * Життєвий цикл серверних сесій (§6.1).
 *
 * Єдине місце, яке знає про формат токена й про те, що в базі лежить його геш.
 * Контролери оперують сирим токеном із кукі і нічого про це не знають.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Повертає СИРИЙ токен — його бачить лише кукі, у базу пішов лише геш. */
  async create(userId: string): Promise<string> {
    const token = generateToken()

    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    })

    return token
  }

  /**
   * Перевіряє токен із кукі й повертає власника сесії.
   *
   * Прострочена або відкликана сесія — це `null`, а не помилка: для викликача
   * різниці немає, а зайвий сигнал «сесія існує, але протухла» нікому не потрібен.
   */
  async validate(token: string): Promise<UserModel | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    })

    if (session === null) return null
    if (session.revokedAt !== null) return null
    if (session.expiresAt.getTime() <= Date.now()) return null

    // Час останнього використання — єдине, що пишеться на читанні. Ковзного
    // продовження терміну тут немає навмисно: сесія живе рівно SESSION_TTL_MS від
    // логіну, інакше активний користувач не розлогінюється ніколи.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    })

    return session.user
  }

  /** Logout. Мовчить, якщо такої сесії немає — повторний вихід не помилка. */
  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  /**
   * Відкликає всі сесії користувача. Викликається після зміни пароля: інакше той,
   * хто вкрав сесію, лишається всередині саме тоді, коли жертва рятує акаунт.
   *
   * `client` дозволяє виконати відкликання в чужій транзакції — скидання пароля
   * і розлогінення мусять або статися разом, або не статися зовсім.
   */
  async revokeAllForUser(userId: string, client: SessionWriter = this.prisma): Promise<number> {
    const { count } = await client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    return count
  }

  /**
   * Прибирання простроченого. Відкликані сесії теж ідуть звідси, але лише коли
   * їхній термін і так вичерпано — доти рядок лишається як слід відкликання.
   */
  async deleteExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: now } },
    })

    return count
  }
}
