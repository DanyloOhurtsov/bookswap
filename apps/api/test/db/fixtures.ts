import type { PrismaClient } from '../../src/generated/prisma/client'

/**
 * Мінімальний зв'язний граф каталогу: Work → Translation → Edition → Copy плюс
 * власник і потенційний позичальник. Ланцюг не спрощується — саме на ньому
 * тримаються перевірки нижче.
 */
export interface Graph {
  ownerId: string
  borrowerId: string
  workId: string
  translationId: string
  editionId: string
  copyId: string
}

let counter = 0

function unique(prefix: string): string {
  counter += 1

  return `${prefix}-${String(counter)}`
}

export async function createUser(prisma: PrismaClient, displayName = 'Тест'): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${unique('user')}@example.com`,
      passwordHash: 'test-placeholder',
      displayName,
    },
  })

  return user.id
}

export async function createGraph(prisma: PrismaClient): Promise<Graph> {
  const ownerId = await createUser(prisma, 'Власник')
  const borrowerId = await createUser(prisma, 'Позичальник')

  const work = await prisma.work.create({
    data: {
      title: 'Шантарам',
      titleNorm: 'шантарам',
      origLang: 'en',
      createdById: ownerId,
    },
  })

  const translation = await prisma.translation.create({
    data: { workId: work.id, translator: 'Перекладач', lang: 'uk', sourceLang: 'en' },
  })

  const edition = await prisma.edition.create({
    data: { workId: work.id, translationId: translation.id, createdById: ownerId },
  })

  const copy = await prisma.copy.create({
    data: { editionId: edition.id, ownerId, currentHolderId: ownerId },
  })

  return {
    ownerId,
    borrowerId,
    workId: work.id,
    translationId: translation.id,
    editionId: edition.id,
    copyId: copy.id,
  }
}

/**
 * Помилки БД у тестах перевіряються за текстом, а не лише за фактом падіння:
 * інакше тест лишається зеленим, коли запит падає з зовсім іншої причини.
 */
export async function expectRejection(
  promise: Promise<unknown>,
  matcher: RegExp,
): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    expect(String(error)).toMatch(matcher)

    return error
  }

  throw new Error(`Очікувалася помилка БД за ${String(matcher)}, але запит пройшов`)
}

/**
 * Порушення унікальності. Крім тексту звіряється код P2002 — інакше тест лишиться
 * зеленим на будь-якій іншій помилці, що згадала ту саму колонку.
 */
export async function expectUniqueViolation(
  promise: Promise<unknown>,
  field: RegExp,
): Promise<void> {
  const error = await expectRejection(promise, /Unique constraint failed/)

  expect(String(error)).toMatch(field)
  expect((error as { code?: unknown }).code).toBe('P2002')
}
