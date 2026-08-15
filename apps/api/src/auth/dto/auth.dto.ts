import { Transform } from 'class-transformer'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
import { PASSWORD_LIMITS, PROFILE_LIMITS } from '@bookswap/shared'

/**
 * §11: рантайм-валідація DTO через `class-validator` на кожному ендпоінті.
 *
 * Числові межі беруться з `@bookswap/shared` — там же, звідки їх бере zod-схема,
 * якою користується фронт. Тобто дублюється спосіб перевірки, але не самі
 * обмеження; що вони й далі описують одне й те саме, стежить `auth.dto.spec.ts`:
 * він проганяє однакові дані крізь обидва механізми й вимагає однакового вироку.
 */

/** Нормалізація адреси — та сама, що в `emailSchema`: обрізати й у нижній регістр. */
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Некоректна email-адреса' })
  @MaxLength(PROFILE_LIMITS.emailMax)
  email!: string

  @IsString()
  @MinLength(PASSWORD_LIMITS.min, { message: 'Пароль закороткий' })
  @MaxLength(PASSWORD_LIMITS.max, { message: 'Пароль задовгий' })
  password!: string

  @Transform(trimmed)
  @IsString()
  @MinLength(PROFILE_LIMITS.displayNameMin, { message: 'Імʼя закоротке' })
  @MaxLength(PROFILE_LIMITS.displayNameMax, { message: 'Імʼя задовге' })
  displayName!: string
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Некоректна email-адреса' })
  @MaxLength(PROFILE_LIMITS.emailMax)
  email!: string

  /**
   * Політика довжини тут не застосовується навмисно: інакше акаунт зі старим
   * коротким паролем відповідав би «пароль закороткий», а неіснуючий —
   * «невірні дані», і форма входу почала б розрізняти ці випадки.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_LIMITS.max)
  password!: string
}

export class ConfirmEmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string
}

export class RequestPasswordResetDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Некоректна email-адреса' })
  @MaxLength(PROFILE_LIMITS.emailMax)
  email!: string
}

export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string

  @IsString()
  @MinLength(PASSWORD_LIMITS.min, { message: 'Пароль закороткий' })
  @MaxLength(PASSWORD_LIMITS.max, { message: 'Пароль задовгий' })
  password!: string
}
