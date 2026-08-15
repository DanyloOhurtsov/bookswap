import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { API_ERROR_CODES } from '@bookswap/shared'
import type { ConfirmPasswordResetRequest, LoginRequest, RegisterRequest } from '@bookswap/shared'
import { ApiException } from '../common/api.exception'
import { EMAIL_SENDER, type EmailSender } from '../email/email-sender'
import { PrismaService } from '../prisma/prisma.service'
import { EMAIL_VERIFICATION_TTL_MS, PASSWORD_RESET_TTL_MS } from './auth.constants'
import { PasswordService } from './password.service'
import { SessionService } from './session.service'
import { generateToken, hashToken } from './tokens'
import type { UserModel } from '../generated/prisma/models'

/**
 * Геш неіснуючого пароля. Потрібен, щоб логін на невідомий email коштував рівно
 * стільки ж часу, скільки логін із неправильним паролем: інакше час відповіді
 * сам стає відповіддю на питання «чи є такий акаунт».
 */
const DUMMY_PASSWORD = 'timing-equalizer-not-a-real-password'

interface Authenticated {
  user: UserModel
  sessionToken: string
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private dummyHash: Promise<string> | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async register(request: RegisterRequest): Promise<Authenticated> {
    const passwordHash = await this.passwords.hash(request.password)

    const existing = await this.prisma.user.findUnique({
      where: { email: request.email },
      select: { id: true },
    })

    if (existing !== null) throw emailTaken()

    let user: UserModel

    try {
      user = await this.prisma.user.create({
        data: {
          email: request.email,
          passwordHash,
          displayName: request.displayName,
        },
      })
    } catch (error) {
      // Перевірка вище не рятує від двох одночасних реєстрацій — останнє слово
      // за унікальним індексом на User.email.
      if (isUniqueViolation(error)) throw emailTaken()
      throw error
    }

    await this.sendEmailVerification(user)

    // Реєстрація одразу створює сесію: інакше єдина дія нового користувача —
    // чекати листа, а в dev пошта нікуди не йде. Доступ при цьому лишається
    // обмеженим прапорцем emailVerified, який фронт показує в профілі.
    return { user, sessionToken: await this.sessions.create(user.id) }
  }

  async login(request: LoginRequest): Promise<Authenticated> {
    const user = await this.prisma.user.findUnique({ where: { email: request.email } })

    if (user === null) {
      await this.passwords.verify(request.password, await this.dummyPasswordHash())
      throw invalidCredentials()
    }

    if (!(await this.passwords.verify(request.password, user.passwordHash))) {
      throw invalidCredentials()
    }

    return { user, sessionToken: await this.sessions.create(user.id) }
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken === undefined) return

    await this.sessions.revoke(sessionToken)
  }

  /** Повторне надсилання листа. Для вже підтвердженої адреси не робить нічого. */
  async resendEmailVerification(user: UserModel): Promise<void> {
    if (user.emailVerified) return

    await this.sendEmailVerification(user)
  }

  async confirmEmail(token: string): Promise<UserModel> {
    const tokenHash = hashToken(token)

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash } })

      if (record === null || !isUsable(record)) throw invalidToken()

      // Одноразовість тримається саме тут: умова `usedAt: null` в UPDATE робить
      // погашення токена атомарним. Дві паралельні спроби — рівно одна з count 1.
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      })

      if (claimed.count !== 1) throw invalidToken()

      return tx.user.update({ where: { id: record.userId }, data: { emailVerified: true } })
    })
  }

  /**
   * §6.1 і вимога етапу: відповідь не залежить від того, чи зареєстрований email.
   * Викликач завжди отримує «прийнято» — і сам метод нічого не повертає.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } })

    if (user === null) {
      // У лог, не у відповідь: адміністратору знати корисно, тому, хто перебирає
      // адреси, — ні.
      this.logger.log('Запит на скидання пароля для невідомої адреси')
      return
    }

    const token = generateToken()

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    })

    await this.email.send({
      to: user.email,
      subject: 'BookSwap: скидання пароля',
      body:
        `Щоб задати новий пароль, перейдіть за посиланням:\n` +
        `${this.link('/reset-password', token)}\n\n` +
        `Посилання дійсне годину. Якщо ви цього не просили — просто зігноруйте лист.`,
    })
  }

  async confirmPasswordReset(request: ConfirmPasswordResetRequest): Promise<void> {
    const tokenHash = hashToken(request.token)
    const passwordHash = await this.passwords.hash(request.password)

    await this.prisma.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({ where: { tokenHash } })

      if (record === null || !isUsable(record)) throw invalidToken()

      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      })

      if (claimed.count !== 1) throw invalidToken()

      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } })

      // Решта невикористаних токенів цього користувача теж гасяться: інакше лист,
      // замовлений двічі, лишає другий ключ від акаунта чинним.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      })

      // Зміна пароля розлогінює всюди — інакше той, хто вкрав сесію, лишається
      // всередині саме тоді, коли жертва рятує акаунт.
      await this.sessions.revokeAllForUser(record.userId, tx)
    })
  }

  private async sendEmailVerification(user: UserModel): Promise<void> {
    const token = generateToken()

    await this.prisma.emailVerificationToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    })

    await this.email.send({
      to: user.email,
      subject: 'BookSwap: підтвердіть адресу',
      body:
        `Вітаємо, ${user.displayName}!\n\n` +
        `Підтвердіть адресу за посиланням:\n` +
        `${this.link('/verify-email', token)}\n\n` +
        `Посилання дійсне добу.`,
    })
  }

  /** Посилання ведуть на фронт, не на API: токен гаситься дією користувача. */
  private link(path: string, token: string): string {
    const base = this.config.getOrThrow<string>('WEB_ORIGIN')

    return `${base}${path}?token=${encodeURIComponent(token)}`
  }

  private dummyPasswordHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(DUMMY_PASSWORD)

    return this.dummyHash
  }
}

function isUsable(record: { usedAt: Date | null; expiresAt: Date }): boolean {
  return record.usedAt === null && record.expiresAt.getTime() > Date.now()
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function emailTaken(): ApiException {
  return new ApiException(
    API_ERROR_CODES.EMAIL_TAKEN,
    'Акаунт із такою адресою вже існує',
    HttpStatus.CONFLICT,
  )
}

function invalidCredentials(): ApiException {
  return new ApiException(
    API_ERROR_CODES.INVALID_CREDENTIALS,
    'Невірна пошта або пароль',
    HttpStatus.UNAUTHORIZED,
  )
}

function invalidToken(): ApiException {
  return new ApiException(
    API_ERROR_CODES.INVALID_TOKEN,
    'Посилання недійсне або вже використане',
    HttpStatus.BAD_REQUEST,
  )
}
