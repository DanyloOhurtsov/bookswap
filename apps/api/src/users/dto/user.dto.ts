import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PROFILE_LIMITS, VISIBILITY, type Visibility } from '@bookswap/shared'

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

/**
 * §6.1: редагувати можна рівно п'ять полів. Email тут немає — його зміна тягне
 * повторне підтвердження і є окремим флоу, а не полем форми профілю.
 *
 * `@IsOptional()` у class-validator пропускає і `undefined`, і `null` — саме те,
 * що потрібно: «не чіпати» і «очистити» — різні наміри, і обидва дозволені для
 * аватарки й біо.
 */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(PROFILE_LIMITS.displayNameMin, { message: 'Імʼя закоротке' })
  @MaxLength(PROFILE_LIMITS.displayNameMax, { message: 'Імʼя задовге' })
  displayName?: string

  @IsOptional()
  @IsUrl({}, { message: 'Некоректне посилання' })
  @MaxLength(PROFILE_LIMITS.avatarUrlMax)
  avatarUrl?: string | null

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(PROFILE_LIMITS.bioMax, { message: 'Біо задовге' })
  bio?: string | null

  @IsOptional()
  @IsIn(VISIBILITY, { message: 'Невідоме значення видимості' })
  libraryVisibility?: Visibility

  @IsOptional()
  @IsBoolean()
  showHolderNames?: boolean
}

/**
 * §6.1: пошук за імʼям — частковий збіг, за email — ТІЛЬКИ точний.
 *
 * Два поля замість одного «шукати всюди» саме тому: адресу не можна підбирати
 * по літері, інакше ендпоінт стає засобом перевірки, хто тут зареєстрований.
 * Взаємовиключність перевіряє контролер — це правило про пару полів, а не про поле.
 */
export class UserSearchDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(2, { message: 'Мінімум два символи' })
  @MaxLength(PROFILE_LIMITS.displayNameMax)
  q?: string

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Некоректна email-адреса' })
  @MaxLength(PROFILE_LIMITS.emailMax)
  email?: string
}
