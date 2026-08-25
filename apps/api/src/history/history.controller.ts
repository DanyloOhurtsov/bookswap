import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common'
import type {
  ApiError,
  CopyHistoryResponse,
  MyHistoryResponse,
  WorkHistoryResponse,
} from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { CanonicalWorkService } from '../catalog/canonical/canonical-work.service'
import { redirectToCanonicalWork } from '../catalog/canonical/work-redirect'
import { HistoryService } from './history.service'
import type { Response } from 'express'
import type { UserModel } from '../generated/prisma/models'

/** §8, блок «Історія». Усі три маршрути — лише читання (§6.6). */
@Controller()
@UseGuards(SessionGuard)
export class HistoryController {
  constructor(
    private readonly history: HistoryService,
    private readonly canonical: CanonicalWorkService,
  ) {}

  @Get('me/history')
  mine(@CurrentUser() user: UserModel): Promise<MyHistoryResponse> {
    return this.history.myHistory(user.id)
  }

  @Get('copies/:id/history')
  ofCopy(
    @CurrentUser() user: UserModel,
    @Param('id') copyId: string,
  ): Promise<CopyHistoryResponse> {
    return this.history.copyHistory(user.id, copyId)
  }

  /**
   * §6.3 requires the redirect for reads, and this is one — the history of a
   * merged work lives on the canonical record, because the merge moved the
   * editions its loans hang off. See `catalog/canonical/work-redirect.ts`.
   */
  @Get('works/:id/history')
  async ofWork(
    @CurrentUser() user: UserModel,
    @Param('id') workId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkHistoryResponse | ApiError> {
    const resolved = await this.canonical.resolve(workId)

    if (resolved.moved) return redirectToCanonicalWork(response, resolved, '/history')

    return this.history.workHistory(user.id, resolved.workId)
  }
}
