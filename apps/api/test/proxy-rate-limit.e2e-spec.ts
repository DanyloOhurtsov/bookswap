import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import { API_PREFIX } from '@bookswap/shared'
import { createTestApp, uniqueEmail } from './auth.helpers'

/**
 * Rate limiting за реверс-проксі (§11 + §13.2).
 *
 * У проді перед API стоїть Caddy, тож без `trust proxy` Express бачить IP проксі —
 * один і той самий для всіх. Ліміт спроб входу тоді стає глобальним: перший, хто
 * його вичерпає, замикає вхід усім. Але довіряти `X-Forwarded-For` можна лише
 * там, де його справді ставить проксі: локально цей заголовок повністю
 * контролюється клієнтом, і довіра до нього — це спосіб обійти будь-який ліміт.
 *
 * Тому обидві поведінки перевіряються окремо, на двох застосунках.
 */
describe('Rate limiting за проксі (e2e)', () => {
  const url = (path: string): string => `${API_PREFIX}${path}`

  /** Ліміт логіну — 10 за 15 хвилин, тож 11 спроб гарантовано впираються в стелю. */
  const ATTEMPTS = 11

  async function exhaustLogin(app: INestApplication<App>, forwardedFor: string): Promise<number[]> {
    const statuses: number[] = []

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .set('X-Forwarded-For', forwardedFor)
        .send({ email: uniqueEmail('proxy'), password: 'nepravylnyj-parol' })

      statuses.push(response.status)
    }

    return statuses
  }

  async function loginOnce(app: INestApplication<App>, forwardedFor: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .post(url('/auth/login'))
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: uniqueEmail('proxy'), password: 'nepravylnyj-parol' })

    return response.status
  }

  describe('trustProxy: true — так працює прод за Caddy', () => {
    let app: INestApplication<App>

    beforeAll(async () => {
      app = await createTestApp({ withRateLimit: true, trustProxy: true })
    })

    afterAll(async () => {
      await app.close()
    })

    it('рахує ліміт окремо для кожного клієнтського IP', async () => {
      const statuses = await exhaustLogin(app, '203.0.113.10')

      expect(statuses).toContain(429)

      // Інший клієнт того самого проксі не має страждати від чужого перебору.
      expect(await loginOnce(app, '203.0.113.20')).not.toBe(429)

      // А вичерпаний IP лишається вичерпаним.
      expect(await loginOnce(app, '203.0.113.10')).toBe(429)
    })

    it('бере найближчий до проксі IP, а не найлівіший у ланцюжку', async () => {
      // Клієнт може дописати свій X-Forwarded-For — Caddy додасть справжній IP
      // праворуч. З `trust proxy = 1` довіряється рівно останній стрибок, тож
      // підставлений зліва «чужий» IP не створює нового відра.
      const spoofed = '198.51.100.7'
      const real = '203.0.113.30'

      const statuses: number[] = []

      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post(url('/auth/login'))
          .set('X-Forwarded-For', `${spoofed}, ${real}`)
          .send({ email: uniqueEmail('proxy'), password: 'nepravylnyj-parol' })

        statuses.push(response.status)
      }

      expect(statuses).toContain(429)

      // Той самий справжній IP із іншим підставленим префіксом — те саме відро.
      const other = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .set('X-Forwarded-For', `192.0.2.99, ${real}`)
        .send({ email: uniqueEmail('proxy'), password: 'nepravylnyj-parol' })

      expect(other.status).toBe(429)
    })
  })

  describe('trustProxy: false — так працює dev без проксі', () => {
    let app: INestApplication<App>

    beforeAll(async () => {
      app = await createTestApp({ withRateLimit: true, trustProxy: false })
    })

    afterAll(async () => {
      await app.close()
    })

    it('ігнорує X-Forwarded-For — зміна заголовка не скидає лічильник', async () => {
      const statuses = await exhaustLogin(app, '203.0.113.10')

      expect(statuses).toContain(429)

      // Якби заголовку довіряли, це був би безкоштовний обхід ліміту.
      expect(await loginOnce(app, '203.0.113.20')).toBe(429)
      expect(await loginOnce(app, '198.51.100.1')).toBe(429)
    })
  })
})
