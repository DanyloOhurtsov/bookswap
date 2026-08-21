import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { TextNormalizer } from '../text-normalizer'
import { SearchCandidatesController } from './search-candidates.controller'
import { SearchCandidatesService } from './search-candidates.service'

/**
 * Етап 7c. Імпортується в `CatalogModule` так само, як `LookupModule`
 * (Етап 7b): маршрут `/catalog/search/candidates` — той самий простір
 * `catalog`, що й `CatalogController`.
 *
 * `TextNormalizer` реєструється тут окремим провайдером, а не через імпорт
 * `CatalogModule`: `CatalogModule` уже імпортує цей модуль, і зворотний
 * імпорт означав би цикл. Клас без стану (лише обгортка над `PrismaService`,
 * який `@Global()`), тож друга реєстрація не дублює жодних даних.
 */
@Module({
  imports: [AuthModule],
  controllers: [SearchCandidatesController],
  providers: [SearchCandidatesService, TextNormalizer],
})
export class SearchCandidatesModule {}
