'use client'

import {
  loanListResponseSchema,
  loanResponseSchema,
  type Loan,
  type LoanListResponse,
  type LoanQueryRequest,
  type LoanResponse,
  type LoanRole,
} from '@bookswap/shared'
import { useApiResource, type Resource } from './use-resource'

/**
 * §8: `GET /loans?role=owner|borrower&status=…`.
 *
 * Ті самі три стани, що й у решти хуків: «ще вантажу» і «порожньо» — різні речі,
 * і без цієї різниці сторінка блимає написом «запитів немає» на кожному оновленні.
 */
export type LoansResource = Resource<LoanListResponse>
export type LoanResource = Resource<LoanResponse>

function toQuery(filters: LoanQueryRequest): string {
  const parameters = new URLSearchParams()

  if (filters.role !== undefined) parameters.set('role', filters.role)
  if (filters.status !== undefined) parameters.set('status', filters.status)

  const query = parameters.toString()

  return query === '' ? '' : `?${query}`
}

export function useLoans(filters: LoanQueryRequest): LoansResource {
  // Фільтри — обʼєкт, тож ключем запиту стає рядок, а не він сам: новий літерал
  // на кожен рендер перезапускав би завантаження нескінченно.
  return useApiResource(`/loans${toQuery(filters)}`, loanListResponseSchema)
}

/**
 * §8: `GET /loans/:id` — один конкретний лоан.
 *
 * Потрібен для глибоких посилань: сповіщення й картки бібліотеки ведуть до
 * **свого** лоану, а не до списку, де його ще треба знайти. Чужий лоан API
 * віддає як 404, тож фронт не має що тут перевіряти — і не має способу підглянути.
 */
export function useLoan(loanId: string): LoanResource {
  return useApiResource(`/loans/${encodeURIComponent(loanId)}`, loanResponseSchema)
}

/** Бік лоану з погляду того, хто дивиться. Потрібен, щоб обрати набір кнопок. */
export function roleOf(loan: Loan, userId: string): LoanRole {
  return loan.owner.id === userId ? 'owner' : 'borrower'
}

/** Контрагент — той, з ким домовляються. Показувати себе самого сенсу немає. */
export function counterpartOf(loan: Loan, userId: string) {
  return loan.owner.id === userId ? loan.borrower : loan.owner
}
