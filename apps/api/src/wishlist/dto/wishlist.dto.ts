import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { WISHLIST_LIMITS } from '@bookswap/shared'

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

/** §8: `POST /me/wishlist { workId }`. */
export class AddWishlistItemDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: 'Не вказано твір' })
  @MaxLength(WISHLIST_LIMITS.idMax)
  workId!: string
}
