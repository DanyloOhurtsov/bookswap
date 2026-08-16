import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { normalizeSearchText, type RawQueryRunner } from './search-text'

/**
 * Єдина точка входу застосунку в нормалізацію пошукового тексту (§4.4).
 *
 * Провайдер, а не вільна функція, лише щоб `PrismaService` приїхав через DI;
 * саме правило живе в БД — див. `search-text.ts`. Модуль каталогу експортує цей
 * клас, бо `LibraryService` нормалізує ним фільтр `?q=`: пошук у власній
 * бібліотеці мусить поводитися так само, як пошук у каталозі.
 */
@Injectable()
export class TextNormalizer {
  constructor(private readonly prisma: PrismaService) {}

  async normalize(value: string, client: RawQueryRunner = this.prisma): Promise<string> {
    const [normalized] = await normalizeSearchText(client, [value])

    if (normalized === undefined) throw new Error('bookswap_norm не повернув значення')

    return normalized
  }

  normalizeMany(values: string[], client: RawQueryRunner = this.prisma): Promise<string[]> {
    return normalizeSearchText(client, values)
  }
}
