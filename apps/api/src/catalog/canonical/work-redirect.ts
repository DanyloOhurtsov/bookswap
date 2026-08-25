import { HttpStatus } from '@nestjs/common'
import {
  API_ERROR_CODES,
  API_PREFIX,
  type ApiError,
  type WorkMergedDetails,
} from '@bookswap/shared'
import type { Response } from 'express'
import type { CanonicalWork } from './canonical-work.service'

/**
 * §6.3: «Читання за id зі встановленим `mergedIntoId` віддає 301 на канонічний».
 *
 * Written straight onto the response rather than thrown as an exception: a 301
 * is not an error, and `AllExceptionsFilter` has no way to set `Location`.
 * Teaching it one would drag a transport detail into the one place that is
 * supposed to know only about error shapes.
 *
 * `Cache-Control: no-store` is not cosmetic. A 301 is permanently cacheable by
 * default, but this one is not permanent: merging `A→B` and then `B→C` repoints
 * `A.mergedIntoId` at `C`, and a browser holding the old redirect would keep
 * sending people through `B`.
 *
 * The body matches `apiErrorSchema`, so a client that does not follow redirects
 * — supertest, curl — still reads the machine-readable code and the canonical
 * id. A browser follows the header and never sees it.
 */
export function redirectToCanonicalWork(
  response: Response,
  resolved: CanonicalWork,
  /** Path under `/works/:id`, e.g. `''`, `'/translations'`, `'/history'`. */
  suffix = '',
): ApiError {
  const details: WorkMergedDetails = {
    canonicalWorkId: resolved.workId,
    requestedWorkId: resolved.requestedWorkId,
  }

  response.status(HttpStatus.MOVED_PERMANENTLY)
  response.setHeader(
    'Location',
    `${API_PREFIX}/works/${encodeURIComponent(resolved.workId)}${suffix}`,
  )
  response.setHeader('Cache-Control', 'no-store')

  return { code: API_ERROR_CODES.WORK_MERGED, message: `Твір злито у ${resolved.workId}`, details }
}
