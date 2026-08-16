import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CatalogController } from './catalog.controller'
import { CatalogService } from './catalog.service'
import { TextNormalizer } from './text-normalizer'

/**
 * `TextNormalizer` експортується: `LibraryService` нормалізує ним фільтр `?q=`.
 * Нормалізація мусить лишатися однією на весь застосунок — саме тому вона
 * провайдер, а не функція, яку кожен модуль напише собі сам.
 */
@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [CatalogService, TextNormalizer],
  exports: [TextNormalizer],
})
export class CatalogModule {}
