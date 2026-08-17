import request from 'supertest'
import { API_PREFIX } from '@bookswap/shared'
import { VALID_PASSWORD, sessionCookie, uniqueEmail } from './auth.helpers'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'
import type { Visibility } from '@bookswap/shared'

/**
 * Спільний сетап для e2e-файлів позичання, історії та сповіщень.
 *
 * Усім трьом потрібне те саме: двоє зареєстрованих людей, дружба між ними й
 * примірник на полиці. Копіювати ці тридцять рядків утретє означало б, що
 * виправляти їх доведеться теж утричі.
 *
 * Сетап іде **через API**, а не через Prisma: так тест заразом перевіряє, що
 * ланцюг §3 і дружба §6.2 справді працюють разом, а не лише в теорії.
 */

export interface Account {
  id: string
  cookie: string
  displayName: string
}

export const url = (path: string): string => `${API_PREFIX}${path}`

let sequence = 0

export async function registerAccount(
  app: INestApplication<App>,
  prefix = 'loan',
): Promise<Account> {
  sequence += 1

  const displayName = `${prefix} ${String(process.pid)}-${String(sequence)}`
  const response = await request(app.getHttpServer())
    .post(url('/auth/register'))
    .send({ email: uniqueEmail(prefix), password: VALID_PASSWORD, displayName })
    .expect(201)

  return {
    id: (response.body as { user: { id: string } }).user.id,
    cookie: sessionCookie(response.headers),
    displayName,
  }
}

/**
 * §6.2: зустрічний запит = згода, тож двох викликів досить і окремий `PATCH`
 * не потрібен.
 */
export async function befriend(
  app: INestApplication<App>,
  one: Account,
  other: Account,
): Promise<void> {
  await request(app.getHttpServer())
    .post(url('/friends/requests'))
    .set('Cookie', one.cookie)
    .send({ userId: other.id })
    .expect(201)

  await request(app.getHttpServer())
    .post(url('/friends/requests'))
    .set('Cookie', other.cookie)
    .send({ userId: one.id })
    .expect(201)
}

export interface Shelf {
  workId: string
  editionId: string
  copyId: string
}

/**
 * Повний ланцюг §3: `Work → Edition → Copy`. Переклад пропускається — для
 * позичання він ролі не грає, а зайвий крок ускладнив би читання тестів.
 *
 * Назви навмисно нейтральні («Полиця…», «Полицівський…»), а не «Шантарам» і
 * «Ґреґорі Робертс»: e2e-файли ділять одну базу, а ці сценарії створюють десятки
 * книжок. Упізнавані імена засмічували б fuzzy-пошук каталогу й витісняли
 * очікувані записи за ліміт у 20 результатів (§11) — тобто ламали б чужий тест
 * даними, а не кодом.
 */
export async function createShelfCopy(
  app: INestApplication<App>,
  owner: Account,
  visibility: Visibility = 'FRIENDS',
): Promise<Shelf> {
  sequence += 1

  const token = `${String(process.pid)}-${String(sequence)}`
  const work = await request(app.getHttpServer())
    .post(url('/works'))
    .set('Cookie', owner.cookie)
    .send({
      title: `Полиця ${token}`,
      origLang: 'en',
      authors: [{ name: `Полицівський ${token}` }],
    })
    .expect(201)

  const workId = (work.body as { work: { id: string } }).work.id

  const edition = await request(app.getHttpServer())
    .post(url(`/works/${workId}/editions`))
    .set('Cookie', owner.cookie)
    .send({ publisher: 'КСД', year: 2019 })
    .expect(201)

  const editionId = (edition.body as { edition: { id: string } }).edition.id

  const copy = await request(app.getHttpServer())
    .post(url('/me/library'))
    .set('Cookie', owner.cookie)
    .send({ editionId, visibility })
    .expect(201)

  return { workId, editionId, copyId: (copy.body as { copy: { id: string } }).copy.id }
}

/** Запит на позичання. Повертає весь відгук — код перевіряє вже сам тест. */
export function requestLoan(
  app: INestApplication<App>,
  borrower: Account,
  copyId: string,
  body: Record<string, unknown> = {},
): request.Test {
  return request(app.getHttpServer())
    .post(url('/loans'))
    .set('Cookie', borrower.cookie)
    .send({ copyId, ...body })
}

/** Будь-який перехід §5.1 — усі шість дій ідуть крізь один маршрут. */
export function actOnLoan(
  app: INestApplication<App>,
  actor: Account,
  loanId: string,
  body: Record<string, unknown>,
): request.Test {
  return request(app.getHttpServer())
    .patch(url(`/loans/${loanId}`))
    .set('Cookie', actor.cookie)
    .send(body)
}

/** Створений і одразу підтверджений лоан — часта передумова наступних переходів. */
export async function approvedLoan(
  app: INestApplication<App>,
  owner: Account,
  borrower: Account,
  copyId: string,
): Promise<string> {
  const created = await requestLoan(app, borrower, copyId).expect(201)
  const loanId = (created.body as { loan: { id: string } }).loan.id

  await actOnLoan(app, owner, loanId, { action: 'approve' }).expect(200)

  return loanId
}

/** Те саме, доведене до «книжка фізично в позичальника». */
export async function handedOverLoan(
  app: INestApplication<App>,
  owner: Account,
  borrower: Account,
  copyId: string,
): Promise<string> {
  const loanId = await approvedLoan(app, owner, borrower, copyId)

  await actOnLoan(app, borrower, loanId, { action: 'hand_over' }).expect(200)

  return loanId
}
