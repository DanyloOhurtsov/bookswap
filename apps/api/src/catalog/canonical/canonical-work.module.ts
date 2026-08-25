import { Module } from '@nestjs/common'
import { CanonicalWorkService } from './canonical-work.service'

/**
 * Stage 7h is cross-cutting: `CatalogModule`, `HistoryModule` and
 * `WishlistModule` all address a `Work` by an id that came from the client.
 *
 * Hence a module of its own rather than an export from `CatalogModule`: the
 * other two would then drag in `LookupModule` and `SearchCandidatesModule` — an
 * outbound HTTP provider among them — for the sake of one `findUnique`.
 *
 * `PrismaModule` is not imported here; it is `@Global()`.
 */
@Module({
  providers: [CanonicalWorkService],
  exports: [CanonicalWorkService],
})
export class CanonicalWorkModule {}
