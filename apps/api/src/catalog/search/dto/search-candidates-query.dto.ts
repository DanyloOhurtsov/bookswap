import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { CATALOG_LIMITS } from '@bookswap/shared'

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

/**
 * Той самий вхід, що й у `/catalog/search` (§6.3, крок 2): назва або ISBN в
 * одному полі — розрізняє їх сервіс, а не клієнт.
 */
export class SearchCandidatesQueryDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(CATALOG_LIMITS.queryMin, { message: 'Мінімум два символи' })
  @MaxLength(CATALOG_LIMITS.queryMax)
  q!: string
}
