import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional } from 'class-validator'

/**
 * §8: `GET /me/notifications?unread=true`.
 *
 * Глобальний `ValidationPipe` налаштований із `enableImplicitConversion: false`,
 * тож query-параметр приїжджає рядком і сам у булеве не перетвориться —
 * `@IsBoolean()` без перетворення відхиляв би геть усе.
 *
 * Порядок тут значущий і легко переплутати: `plainToInstance` застосовує
 * `@Transform` **до** валідації, тож перевірка бачить уже перетворене значення.
 * Тому трансформ розпізнає рівно два рядки, а будь-що інше лишає як є — і воно
 * падає на `@IsBoolean()` з 400. Мовчазне зведення невідомого рядка до `false`
 * було б гіршим: `?unread=maybe` тихо показав би не той список.
 *
 * Множина допустимих рядків навмисно вузька — рівно та, що в `unreadFlagSchema`
 * зі `shared`. Ширші синоніми («1», «yes», «on») довелося б дублювати в двох
 * механізмах валідації, і перша ж розбіжність пройшла б непоміченою; тест
 * парності звіряє саме вироки, а не джерела.
 */
const parseFlag = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true
  if (value === 'false') return false

  return value
}

export class NotificationQueryDto {
  @IsOptional()
  @IsBoolean({ message: 'Очікується unread=true або unread=false' })
  @Transform(parseFlag)
  unread?: boolean
}
