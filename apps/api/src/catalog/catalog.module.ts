import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CatalogController } from './catalog.controller'
import { CatalogService } from './catalog.service'
import { LookupModule } from './lookup/lookup.module'
import { TextNormalizer } from './text-normalizer'

/**
 * `TextNormalizer` експортується: `LibraryService` нормалізує ним фільтр `?q=`.
 * Нормалізація мусить лишатися однією на весь застосунок — саме тому вона
 * провайдер, а не функція, яку кожен модуль напише собі сам.
 *
 * `LookupModule` (§6.3, крок 1: автозаповнення за ISBN) імпортується тут, а не
 * реєструється окремо в `AppModule`: маршрут `/catalog/lookup` — той самий
 * простір `catalog`, що й `CatalogController`.
 */
@Module({
  imports: [AuthModule, LookupModule],
  controllers: [CatalogController],
  providers: [CatalogService, TextNormalizer],
  exports: [TextNormalizer],
})
export class CatalogModule {}
