import { Transform } from 'class-transformer'
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'
import { FRIEND_REQUEST_ACTIONS, type FriendRequestAction } from '@bookswap/shared'

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

/** Довжина cuid — 25 символів; 64 лишає запас і водночас відсікає сміття в тілі. */
const USER_ID_MAX = 64

/** §8: `POST /friends/requests { userId }`. */
export class CreateFriendRequestDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: 'Не вказано користувача' })
  @MaxLength(USER_ID_MAX)
  userId!: string
}

/**
 * §8: `PATCH /friends/requests/:id { action: accept | decline }`.
 *
 * Одне поле замість двох ендпоінтів — рівно з тієї ж причини, що й у лоанів (§8):
 * усі переходи проходять крізь одну точку, де живе валідація стейт-машини.
 */
export class RespondFriendRequestDto {
  @IsIn(FRIEND_REQUEST_ACTIONS, { message: 'Невідома дія: очікується accept або decline' })
  action!: FriendRequestAction
}
