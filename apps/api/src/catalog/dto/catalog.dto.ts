import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import {
  AUTHOR_ROLE,
  CATALOG_LIMITS,
  EDITION_FORMAT,
  normalizeIsbn13,
  type AuthorRole,
  type EditionFormat,
} from '@bookswap/shared'
import { EachAuthorHasOneSource, IsIsbn13, IsLanguageCode } from '../../common/validators'

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

// Мова нормалізується так само, як email: « UK » з форми має стати `uk`, а не
// бути відхиленою як невідома.
const normalizeLanguage = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

// Дефіси й пробіли в ISBN — оформлення; у базу лягають самі цифри.
const normalizeIsbn = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeIsbn13(value.trim()) : value

export class CatalogSearchDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(CATALOG_LIMITS.queryMin, { message: 'Мінімум два символи' })
  @MaxLength(CATALOG_LIMITS.queryMax)
  q!: string
}

/**
 * Автор твору: **або** id наявного, **або** імʼя нового.
 *
 * Взаємовиключність перевіряє `@EachAuthorHasOneSource()` на самому масиві —
 * `@IsOptional()` тут глушить будь-який інший валідатор своєї властивості.
 */
export class WorkAuthorInputDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(CATALOG_LIMITS.idMax)
  authorId?: string

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(CATALOG_LIMITS.authorNameMax)
  name?: string

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(CATALOG_LIMITS.authorNameMax)
  nameLatin?: string | null

  @IsOptional()
  @IsIn(AUTHOR_ROLE, { message: 'Невідома роль автора' })
  role?: AuthorRole
}

export class CreateWorkDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: 'Не вказано назву' })
  @MaxLength(CATALOG_LIMITS.titleMax)
  title!: string

  @Transform(normalizeLanguage)
  @IsLanguageCode()
  origLang!: string

  @IsOptional()
  @IsInt()
  @Min(CATALOG_LIMITS.yearMin)
  @Max(CATALOG_LIMITS.yearMax)
  firstPubYear?: number | null

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(CATALOG_LIMITS.descriptionMax)
  description?: string | null

  @IsArray()
  @ArrayMinSize(1, { message: 'Потрібен хоча б один автор' })
  @ArrayMaxSize(CATALOG_LIMITS.authorsMax)
  @EachAuthorHasOneSource()
  @ValidateNested({ each: true })
  @Type(() => WorkAuthorInputDto)
  authors!: WorkAuthorInputDto[]
}

export class CreateTranslationDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: 'Не вказано перекладача' })
  @MaxLength(CATALOG_LIMITS.translatorMax)
  translator!: string

  @Transform(normalizeLanguage)
  @IsLanguageCode()
  lang!: string

  /** §10.3: з якої мови перекладали — найсильніший сигнал при cold start. */
  @Transform(normalizeLanguage)
  @IsLanguageCode()
  sourceLang!: string

  @IsOptional()
  @IsInt()
  @Min(CATALOG_LIMITS.yearMin)
  @Max(CATALOG_LIMITS.yearMax)
  year?: number | null

  @IsOptional()
  @IsBoolean()
  isAbridged?: boolean

  @IsOptional()
  @IsBoolean()
  hasNotes?: boolean

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(CATALOG_LIMITS.notesMax)
  notes?: string | null
}

export class CreateEditionDto {
  /** `null` — видання мовою оригіналу (§4.4). */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(CATALOG_LIMITS.idMax)
  translationId?: string | null

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(CATALOG_LIMITS.publisherMax)
  publisher?: string | null

  @IsOptional()
  @IsInt()
  @Min(CATALOG_LIMITS.yearMin)
  @Max(CATALOG_LIMITS.yearMax)
  year?: number | null

  @IsOptional()
  @Transform(normalizeIsbn)
  @IsIsbn13()
  isbn13?: string | null

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CATALOG_LIMITS.pageCountMax)
  pageCount?: number | null

  @IsOptional()
  @IsUrl({}, { message: 'Некоректне посилання' })
  @MaxLength(CATALOG_LIMITS.coverUrlMax)
  coverUrl?: string | null

  @IsOptional()
  @IsIn(EDITION_FORMAT, { message: 'Невідомий формат видання' })
  format?: EditionFormat
}
