import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types'
import { API_ERROR_CODES, API_PREFIX, apiErrorSchema, healthResponseSchema } from '@bookswap/shared'
import { createTestApp } from './auth.helpers'

describe('Health (e2e)', () => {
  // Параметризація типом App прибирає `any` з getHttpServer() — це офіційний
  // спосіб Nest типізувати e2e, а не глушіння правила.
  let app: INestApplication<App>

  beforeAll(async () => {
    // Через `createTestApp()`, а не власною збіркою `AppModule`: інакше цей файл
    // лишався б єдиним, у якому фонова робота працює за розкладом. Дайджест
    // робить перший прохід одразу на `onModuleInit` — по ВСІХ лоанах спільної
    // бази, тобто чужих, — і через `dispatchSoon()` будить диспетчер. Конфігурація
    // застосунку та сама: `createTestApp` кличе той самий `configureApp`.
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it(`GET ${API_PREFIX}/health віддає відповідь за спільним контрактом`, async () => {
    const response = await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200)

    // Розбираємо тією ж схемою, якою користується apps/web — контракт спільний.
    const parsed = healthResponseSchema.parse(response.body)
    expect(parsed.status).toBe('ok')
    expect(parsed.version).toBe('0.1.0')
  })

  it('health не залежить від бази — відповідає, поки Prisma не підключена', async () => {
    // Модуль скомпільовано й піднято без жодного підключення до PostgreSQL:
    // health не має права падати через недоступну базу на цьому етапі.
    await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200)
  })

  it('невідомий маршрут повертає 404 з машиночитним code', async () => {
    const response = await request(app.getHttpServer()).get(`${API_PREFIX}/nope`).expect(404)

    const error = apiErrorSchema.parse(response.body)
    expect(error.code).toBe(API_ERROR_CODES.NOT_FOUND)
  })

  it('маршрути живуть саме під /api/v1, без префікса їх немає', async () => {
    await request(app.getHttpServer()).get('/health').expect(404)
  })
})
