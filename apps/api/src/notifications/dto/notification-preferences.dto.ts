import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator'
import {
  NOTIFICATION_PREFERENCE_LIMITS,
  NOTIFICATION_TYPE,
  PREFERENCE_CHANNEL,
  type NotificationType,
  type PreferenceChannel,
} from '@bookswap/shared'
import { EachPreferenceCellOnce } from '../../common/validators'

/**
 * §8: `PUT /me/notification-preferences`.
 *
 * §11 вимагає `class-validator` на кожному ендпоінті, а контракт §12.1 живе в
 * `shared` як zod-схема. Значення переліків беруться **звідти ж** — переписані
 * вдруге, вони розійшлися б із першим новим типом події, і тест парності цього не
 * побачив би: він порівнює вироки двох механізмів, а не їхні джерела.
 */
export class NotificationPreferenceDto {
  @IsIn(NOTIFICATION_TYPE, { message: 'Невідомий тип сповіщення' })
  type!: NotificationType

  /** Усі три канали §4.8, `IN_APP` включно (див. `domain/channel.ts`). */
  @IsIn(PREFERENCE_CHANNEL, { message: 'Невідомий канал доставки' })
  channel!: PreferenceChannel

  @IsBoolean()
  enabled!: boolean
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Порожній список нічого не змінює' })
  @ArrayMaxSize(NOTIFICATION_PREFERENCE_LIMITS.matrixSize, {
    message: 'Клітинок більше, ніж є в матриці — отже, є дублікати',
  })
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  @EachPreferenceCellOnce()
  preferences!: NotificationPreferenceDto[]
}
