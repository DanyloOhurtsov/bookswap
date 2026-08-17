import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import type { CopyHistoryResponse, MyHistoryResponse, WorkHistoryResponse } from '@bookswap/shared'
import { CurrentUser } from '../auth/authenticated-request'
import { SessionGuard } from '../auth/session.guard'
import { HistoryService } from './history.service'
import type { UserModel } from '../generated/prisma/models'

/** §8, блок «Історія». Усі три маршрути — лише читання (§6.6). */
@Controller()
@UseGuards(SessionGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

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

  @Get('works/:id/history')
  ofWork(
    @CurrentUser() user: UserModel,
    @Param('id') workId: string,
  ): Promise<WorkHistoryResponse> {
    return this.history.workHistory(user.id, workId)
  }
}
