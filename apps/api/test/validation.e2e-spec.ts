import 'reflect-metadata'
import { Body, Controller, Post, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator'
import request from 'supertest'
import type { App } from 'supertest/types'
import { API_ERROR_CODES, API_PREFIX, apiErrorSchema } from '@bookswap/shared'
import { configureApp } from '../src/app.setup'

/**
 * Фікстура, а не доменний ендпоінт.
 *
 * §11 вимагає рантайм-валідацію DTO через class-validator на кожному ендпоінті.
 * Доменних DTO на цьому етапі ще немає, тож перевіряємо саму інфраструктуру —
 * глобальний ValidationPipe і його стик із фільтром помилок — на тимчасовому
 * контролері, який існує лише всередині цього тесту.
 */
class FixtureDto {
  @IsString()
  @MinLength(2)
  title!: string

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number
}

@Controller('fixture')
class FixtureController {
  @Post()
  create(@Body() dto: FixtureDto): FixtureDto {
    return dto
  }
}

describe('Валідація DTO (e2e)', () => {
  let app: INestApplication<App>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FixtureController],
    }).compile()

    app = moduleRef.createNestApplication<INestApplication<App>>()
    configureApp(app)
    // Один слухач на файл — та сама причина, що й у `createTestApp()`.
    await app.listen(0)
  })

  afterAll(async () => {
    await app.close()
  })

  const url = `${API_PREFIX}/fixture`

  it('пропускає валідне тіло', async () => {
    const response = await request(app.getHttpServer())
      .post(url)
      .send({ title: 'Шантарам', rating: 5 })
      .expect(201)

    expect(response.body).toEqual({ title: 'Шантарам', rating: 5 })
  })

  it('відхиляє порушення обмежень із кодом VALIDATION_ERROR і переліком у details', async () => {
    const response = await request(app.getHttpServer())
      .post(url)
      .send({ title: 'x', rating: 9 })
      .expect(400)

    const error = apiErrorSchema.parse(response.body)
    expect(error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    expect(Array.isArray(error.details)).toBe(true)
    expect(error.details).toHaveLength(2)
  })

  it('відхиляє зайві поля — whitelist працює у forbid-режимі', async () => {
    const response = await request(app.getHttpServer())
      .post(url)
      .send({ title: 'Шантарам', rating: 5, isAdmin: true })
      .expect(400)

    const error = apiErrorSchema.parse(response.body)
    expect(error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
    expect(JSON.stringify(error.details)).toContain('isAdmin')
  })

  it('не приводить типи неявно: рядок замість числа — це помилка', async () => {
    await request(app.getHttpServer())
      .post(url)
      .send({ title: 'Шантарам', rating: '5' })
      .expect(400)
  })

  it('відхиляє відсутні обовʼязкові поля', async () => {
    const response = await request(app.getHttpServer()).post(url).send({}).expect(400)

    expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.VALIDATION_ERROR)
  })
})
