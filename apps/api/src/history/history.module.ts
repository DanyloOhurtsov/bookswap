import { Module } from '@nestjs/common'
import { AccessModule } from '../access/access.module'
import { AuthModule } from '../auth/auth.module'
import { HistoryController } from './history.controller'
import { HistoryService } from './history.service'

/**
 * `LoansModule` тут навмисно НЕ імпортується: історія лише читає `Loan`, і
 * відсутність доступу до `LoanService` — найдешевший спосіб не порушити §5.
 */
@Module({
  imports: [AuthModule, AccessModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
