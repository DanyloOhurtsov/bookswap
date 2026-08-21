import { Transform } from 'class-transformer'
import { IsString } from 'class-validator'
import { normalizeIsbn13 } from '@bookswap/shared'
import { IsIsbn13 } from '../../../common/validators'

// Дефіси й пробіли в ISBN — оформлення; невалідний ISBN мусить дати 400 ДО
// будь-якого зовнішнього виклику (DoD 7b), тому нормалізація й перевірка
// контрольної суми відбуваються в самому DTO, до `LookupService`.
const normalizeIsbn = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeIsbn13(value.trim()) : value

export class LookupQueryDto {
  @Transform(normalizeIsbn)
  @IsString()
  @IsIsbn13()
  isbn!: string
}
