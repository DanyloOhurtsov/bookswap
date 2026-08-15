import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import { API_PREFIX } from '@bookswap/shared'
import { SessionCleanupService } from '../src/auth/session-cleanup.service'
import { hashToken } from '../src/auth/tokens'
import { PrismaService } from '../src/prisma/prisma.service'
import { VALID_PASSWORD, createTestApp, sessionCookie, uniqueEmail } from './auth.helpers'

describe('Очищення простроченого (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let cleanup: SessionCleanupService

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    cleanup = app.get(SessionCleanupService)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerWithToken(): Promise<{ tokenHash: string; email: string }> {
    const email = uniqueEmail('cleanup')
    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({ email, password: VALID_PASSWORD, displayName: 'Прибиральник' })
      .expect(201)

    const raw = sessionCookie(response.headers).split('=')[1] ?? ''

    return { tokenHash: hashToken(raw), email }
  }

  it('видаляє прострочені сесії й лишає чинні', async () => {
    const expired = await registerWithToken()
    const alive = await registerWithToken()

    await prisma.session.update({
      where: { tokenHash: expired.tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await cleanup.run()

    expect(await prisma.session.findUnique({ where: { tokenHash: expired.tokenHash } })).toBeNull()
    expect(
      await prisma.session.findUnique({ where: { tokenHash: alive.tokenHash } }),
    ).not.toBeNull()
  })

  it('видаляє прострочені токени підтвердження і скидання', async () => {
    const { email } = await registerWithToken()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(`reset-${user.id}`),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await cleanup.run()

    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0)
  })

  it('відкликана, але ще не прострочена сесія лишається як слід відкликання', async () => {
    const { tokenHash } = await registerWithToken()

    await prisma.session.update({ where: { tokenHash }, data: { revokedAt: new Date() } })
    await cleanup.run()

    const session = await prisma.session.findUnique({ where: { tokenHash } })

    expect(session).not.toBeNull()
    expect(session?.revokedAt).not.toBeNull()
  })
})
