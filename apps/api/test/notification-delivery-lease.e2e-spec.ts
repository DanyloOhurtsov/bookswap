import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTestApp } from './auth.helpers'
import { registerAccount } from './loan.helpers'
import { NOTIFICATION_CHANNELS } from '../src/notifications/channels/notification-channel'
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher.service'
import { NotificationsService } from '../src/notifications/notifications.service'
import { MAX_DELIVERY_ATTEMPTS } from '../src/notifications/notifications.constants'
import { EMAIL_SENDER } from '../src/email/email-sender'
import { PrismaService } from '../src/prisma/prisma.service'
import { waitForBlockedBackend } from './concurrency.helpers'
import type { EmailMessage, EmailSender } from '../src/email/email-sender'
import type { NotificationChannelSender } from '../src/notifications/channels/notification-channel'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/** Обіцянка, якою керує тест: жодних `sleep`, лише явні сигнали. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })

  return { promise, resolve }
}

interface Gate {
  /** Спрацьовує, щойно відправник увійшов у `send`. */
  entered: ReturnType<typeof deferred>
  /** Тест відпускає відправника, коли захоче. */
  release: ReturnType<typeof deferred>
}

/**
 * §7.3, правило 2: оренда, fencing-токен і межа спроби.
 *
 * Це той файл, який ловить найдорожчу помилку черги — подвійну відправку й
 * затирання свіжого результату застарілим. Обидва сценарії тут **детерміновані**:
 * відправник зупиняється на обіцянці, яку відпускає тест, а протухання оренди
 * влаштовується явним записом у базу, а не очікуванням. Тест, побудований на
 * `setTimeout(…, 100)`, ловив би це раз на п'ять прогонів і «мигав» би в CI.
 */
describe('Оренда доставки (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let notifications: NotificationsService
  let first: NotificationDispatcher

  const sent: EmailMessage[] = []
  let gates: Gate[] = []

  /**
   * Листи акаунта (`registerAccount` надсилає підтвердження адреси) проходять
   * повз ворота й повз лічильник.
   *
   * Це не косметика: без фільтра перший же реєстраційний лист «з'їдав» би ворота,
   * приготовані для доставки сповіщення, і тест зупиняв би не те, що збирався.
   */
  const isNotification = (message: EmailMessage): boolean => !message.body.includes('/verify-email')

  const emailSender: EmailSender = {
    async send(message) {
      if (!isNotification(message)) return

      sent.push(message)

      const gate = gates.shift()

      if (gate === undefined) return

      gate.entered.resolve()
      await gate.release.promise
    },
  }

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(EMAIL_SENDER).useValue(emailSender)
      },
    })

    prisma = app.get(PrismaService)
    notifications = app.get(NotificationsService)
    first = app.get(NotificationDispatcher)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Черга спорожняється перед кожним сценарієм: диспетчер забирає ВСЕ, що
    // дозріло, і рядки сусідніх сценаріїв зіпсували б підрахунок відправок.
    await prisma.notificationDelivery.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'SENT', sentAt: new Date(), leaseToken: null, leaseUntil: null },
    })

    sent.length = 0
    gates = []
  })

  /** Другий незалежний воркер на тій самій базі — як другий процес API. */
  function otherDispatcher(): NotificationDispatcher {
    return new NotificationDispatcher(
      prisma,
      app.get(ConfigService),
      app.get<readonly NotificationChannelSender[]>(NOTIFICATION_CHANNELS),
    )
  }

  /** Користувач із єдиним доступним каналом — щоб доставка була рівно одна. */
  async function emailOnlyUser(prefix: string): Promise<string> {
    const account = await registerAccount(app, prefix)

    await prisma.user.update({ where: { id: account.id }, data: { emailVerified: true } })
    await prisma.notificationPreference.create({
      data: { userId: account.id, type: 'LOAN_REQUESTED', channel: 'IN_APP', enabled: false },
    })

    return account.id
  }

  /** Одна `PENDING`-доставка каналом EMAIL. Повертає її id. */
  async function pendingDelivery(prefix: string): Promise<string> {
    const userId = await emailOnlyUser(prefix)

    await notifications.create({
      userId,
      type: 'LOAN_REQUESTED',
      payload: { loanId: `loan-${userId}`, copyId: `copy-${userId}` },
    })

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notification: { userId }, channel: 'EMAIL' },
    })

    return delivery.id
  }

  const rowOf = (id: string) => prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })

  it('поки оренда жива, другий воркер рядок не бере', async () => {
    const deliveryId = await pendingDelivery('lease-held')
    const gate: Gate = { entered: deferred(), release: deferred() }

    gates.push(gate)

    const running = first.run()

    // Перший уже всередині `send` — рядок захоплений і оренда жива.
    await gate.entered.promise

    const held = await rowOf(deliveryId)

    expect(held.leaseToken).not.toBeNull()
    expect(held.attempts).toBe(1)

    // Другий воркер проходить чергу цілком, поки перший висить у мережі.
    const second = otherDispatcher()

    expect(await second.run()).toBe(0)

    gate.release.resolve()
    await running

    const finished = await rowOf(deliveryId)

    // Рівно одна зовнішня відправка — і саме вона записана як результат.
    expect(sent).toHaveLength(1)
    expect(finished.status).toBe('SENT')
    expect(finished.attempts).toBe(1)
    expect(finished.leaseToken).toBeNull()
  })

  /**
   * Гонка ДО зовнішнього ефекту відрізняється від неоднозначного provider
   * timeout нижче. Тут воркер A ще лише читає контекст (`load()`), тож його
   * виклик провайдера можна й треба відвернути повністю: після reclaim воркером
   * B атомарний pre-send renew не проходить за старим токеном/attempts.
   */
  it('протухла під час load оренда не допускає старий worker до provider', async () => {
    const deliveryId = await pendingDelivery('lease-pre-send-fence')
    const loadGate: Gate = { entered: deferred(), release: deferred() }
    const originalFindUnique = prisma.copy.findUnique.bind(prisma.copy)
    const loadSpy = jest.spyOn(prisma.copy, 'findUnique').mockImplementationOnce((async (
      args: never,
    ) => {
      loadGate.entered.resolve()
      await loadGate.release.promise

      return originalFindUnique(args)
    }) as never)
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation()

    try {
      const workerA = otherDispatcher()
      const runningA = workerA.run()

      // A уже claim-нув рядок, але ще не дійшов до sender.send().
      await loadGate.entered.promise

      const claimedByA = await rowOf(deliveryId)

      expect(claimedByA.status).toBe('PENDING')
      expect(claimedByA.attempts).toBe(1)
      expect(claimedByA.leaseToken).not.toBeNull()
      expect(sent).toHaveLength(0)

      // Без 60-секундного sleep: база отримує рівно форму протухлої оренди.
      const expired = new Date(Date.now() - 1000)

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseUntil: expired, nextAttemptAt: expired },
      })

      // B reclaim-ить і єдиним зовнішнім викликом завершує доставку.
      const workerB = otherDispatcher()

      expect(await workerB.run()).toBe(1)
      expect(sent).toHaveLength(1)

      // A дочитує load, але його conditional UPDATE … RETURNING уже не бачить
      // ані свого токена, ані своєї спроби — provider вдруге не викликається.
      loadGate.release.resolve()
      await runningA

      const final = await rowOf(deliveryId)

      expect(sent).toHaveLength(1)
      expect(final.status).toBe('SENT')
      expect(final.attempts).toBe(2)
      expect(final.leaseToken).toBeNull()
      expect(final.error).toBeNull()

      const staleLogs = warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes(deliveryId))
      const winnerLogs = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes(deliveryId))

      expect(staleLogs).toEqual([
        expect.stringMatching(/канал EMAIL, статус LEASE_LOST, спроба 1.*до початку зовнішньої/),
      ])
      expect(winnerLogs).toEqual([expect.stringMatching(/канал EMAIL, статус SENT, спроба 2/)])
    } finally {
      loadGate.release.resolve()
      loadSpy.mockRestore()
      warnSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  /**
   * Головний сценарій fencing — і місце, де важливо не збрехати собі про
   * гарантії.
   *
   * Воркер завис так надовго, що його оренда протухла (у проді це пауза GC,
   * зупинений контейнер або мережа, яка «думає»). Рядок законно забирає другий і
   * доводить справу до кінця. Коли перший нарешті прокидається, він **не має
   * права** записати свій результат: інакше свіжий `SENT` перетворився б на
   * старий `PENDING` із поверненням у чергу.
   *
   * Але fencing захищає лише СТАН БАЗИ, а не сам зовнішній виклик: `Promise.race`
   * у `withTimeout` не скасовує реальний HTTP-запит, який уже пішов у мережу, —
   * він просто перестає його чекати. Це означає, що перший воркер, чий виклик
   * `send()` зрештою (пізно) успішно завершується, — це ДРУГА реальна відправка
   * листа, окрім тієї, яку зробив другий воркер. Провайдерська межа тут — не
   * exactly-once, а at-least-once: гарантія «рівно один зовнішній виклик»
   * тримається лише для двох ЗДОРОВИХ воркерів із чинними орендами; протухла
   * оренда — це вже інший, слабший контракт, і тест звіряє РЕАЛЬНУ кількість
   * викликів (`sent.length === 2`), а не ховає її за перевіркою самого лише
   * фінального запису в БД.
   */
  it('після протухлої оренди БД записує лише один результат, хоча зовнішній виклик стався двічі', async () => {
    const deliveryId = await pendingDelivery('lease-fenced')
    const gate: Gate = { entered: deferred(), release: deferred() }

    gates.push(gate)

    const stalled = first.run()

    await gate.entered.promise

    const claimed = await rowOf(deliveryId)
    const staleToken = claimed.leaseToken

    expect(staleToken).not.toBeNull()

    // Протухання оренди — явним записом, а не очікуванням: саме так виглядає
    // рядок, чий власник завис довше за оренду.
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { leaseUntil: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000) },
    })

    // Другий воркер законно перехоплює рядок і доводить доставку до кінця.
    const second = otherDispatcher()

    expect(await second.run()).toBe(1)

    const takenOver = await rowOf(deliveryId)

    expect(takenOver.status).toBe('SENT')
    expect(takenOver.attempts).toBe(2)
    expect(takenOver.leaseToken).toBeNull()

    const sentAtByWinner = takenOver.sentAt

    // Аж тепер перший «прокидається» й намагається записати свій результат.
    gate.release.resolve()
    await stalled

    const final = await rowOf(deliveryId)

    expect(final.status).toBe('SENT')
    expect(final.attempts).toBe(2)
    expect(final.sentAt?.toISOString()).toBe(sentAtByWinner?.toISOString())
    expect(final.error).toBeNull()
    // Рядок не повернувся в чергу й не отримав третьої спроби — саме це й ловить
    // fencing. Без нього застарілий воркер записав би `PENDING` поверх `SENT`.
    expect(final.status).not.toBe('PENDING')
    expect(final.leaseToken).toBeNull()

    // Дві реальні зовнішні відправки: перша — власний, пізній виклик first,
    // друга — той, яким справу довів second. Fencing захищає ЗАПИС у БД, а не
    // сам мережевий виклик: `Promise.race` у `withTimeout` не скасовує вже
    // запущений `send()`, тож він однаково доходить до кінця. Провайдерська
    // межа тут — at-least-once, і тест звіряє це прямо, а не ховає за фінальним
    // станом одного рядка в БД.
    expect(sent).toHaveLength(2)
  })

  /**
   * Та сама перевірка з іншого боку: невдача застарілого воркера теж не має
   * права нічого записати. Інакше вона зіпсувала б `error` і — головне —
   * інкрементувала б чергу назад у `PENDING` поверх чужого `SENT`.
   */
  it('невдача застарілого воркера теж нічого не записує', async () => {
    const deliveryId = await pendingDelivery('lease-fenced-fail')
    const gate: Gate = { entered: deferred(), release: deferred() }

    gates = [
      // Перший виклик: зависає, потім падає.
      gate,
    ]

    const failing = async (): Promise<void> => {
      const pending = gates.shift()

      if (pending === undefined) return

      pending.entered.resolve()
      await pending.release.promise

      throw new Error('Застарілий воркер упав')
    }

    const stalledDispatcher = new NotificationDispatcher(prisma, app.get(ConfigService), [
      { channel: 'EMAIL', send: () => failing() },
    ])

    const stalled = stalledDispatcher.run()

    await gate.entered.promise

    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { leaseUntil: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000) },
    })

    const second = otherDispatcher()

    expect(await second.run()).toBe(1)

    gate.release.resolve()
    await stalled

    const final = await rowOf(deliveryId)

    expect(final.status).toBe('SENT')
    expect(final.error).toBeNull()
  })

  describe('§7.3: лічильник спроб не переганяє ліміт', () => {
    /**
     * Так виглядає воркер, що помер між захопленням і записом результату на
     * п'ятій спробі: `attempts = 5`, статус `PENDING`, оренда протухла.
     * Захоплення такий рядок більше не бере, тож без «добивання» він висів би в
     * черзі вічно, вдаючи роботу, якої ніхто не робить.
     */
    it('покинутий на останній спробі рядок стає FAILED без шостої відправки', async () => {
      const deliveryId = await pendingDelivery('lease-reap')

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: MAX_DELIVERY_ATTEMPTS,
          leaseToken: 'мертвий-воркер',
          leaseUntil: new Date(Date.now() - 1000),
          nextAttemptAt: new Date(Date.now() - 1000),
        },
      })

      await first.run()

      const row = await rowOf(deliveryId)

      expect(row.status).toBe('FAILED')
      expect(row.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
      expect(sent).toHaveLength(0)
    })

    /** Живу оренду на останній спробі чіпати не можна — там іще працює воркер. */
    it('останню спробу з живою орендою не забирає', async () => {
      const deliveryId = await pendingDelivery('lease-alive')

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: MAX_DELIVERY_ATTEMPTS,
          leaseToken: 'живий-воркер',
          leaseUntil: new Date(Date.now() + 60_000),
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      })

      await first.run()

      const row = await rowOf(deliveryId)

      expect(row.status).toBe('PENDING')
      expect(row.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
    })

    /**
     * Дефект, який закривав цей раунд: `reap()` розділяв «прочитати кандидатів»
     * (`findMany`) і «записати FAILED» (`updateMany` за самим лише `id`) — двома
     * окремими автокомітними запитами. Вікно між ними: `reap()` прочитав рядок
     * як покинутий, а «пізній» воркер — той, чий мережевий виклик зрештою
     * (пізно) таки завершився успішно й пройшов fencing у `finish()`
     * (`leaseToken` на момент читання ще збігався) — устиг дописати `SENT` саме
     * в цю мить. Другий крок бив по голому `id` і не бачив різниці: свіжий
     * `SENT` перетворювався на `FAILED`.
     *
     * Тест ставить бар'єр рівно в цю точку: «пізній» `finish()` тримає рядок
     * заблокованим у відкритій (ще не закомiченій) транзакції, поки `reap()`
     * своїм єдиним `UPDATE … RETURNING` намагається дістатися того самого
     * рядка — і справді блокується на РЕАЛЬНОМУ PostgreSQL-локу
     * (`waitForBlockedBackend`, не проскакує повз нього SKIP LOCKED'ом). Лише
     * після цього тест комітить `SENT`, і розблокований `reap()` перечитує
     * `WHERE` заново на вже оновлених даних (EvalPlanQual): рядок більше не
     * `PENDING`, тож просто не потрапляє в `RETURNING`.
     */
    it('пізній SENT, що комітиться під час reap(), не перезаписується на FAILED', async () => {
      const deliveryId = await pendingDelivery('lease-reap-barrier')
      const staleToken = 'пізній-воркер'

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: MAX_DELIVERY_ATTEMPTS,
          leaseToken: staleToken,
          leaseUntil: new Date(Date.now() - 1000),
          nextAttemptAt: new Date(Date.now() - 1000),
        },
      })

      const barrier: Gate = { entered: deferred(), release: deferred() }

      // Той самий UPDATE, яким `finish()` записує успіх, — з умовою на
      // `leaseToken`, що й є fencing'ом. Транзакція навмисно не комітиться,
      // доки тест не відпустить гейт: саме це тримає рядковий лок, на якому
      // має заблокуватися `reap()`.
      const lateFinish = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
            UPDATE "NotificationDelivery"
            SET "status" = 'SENT', "sentAt" = now(), "error" = NULL,
                "leaseToken" = NULL, "leaseUntil" = NULL
            WHERE "id" = ${deliveryId} AND "leaseToken" = ${staleToken}
          `

        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const reaping = otherDispatcher().run()

      // Доводимо РЕАЛЬНУ контенцію: `reap()` не проскочив повз рядок, а
      // справді чекає на локу, який тримає незакомічена транзакція вище.
      await waitForBlockedBackend(prisma)

      barrier.release.resolve()
      await lateFinish
      await reaping

      const row = await rowOf(deliveryId)

      expect(row.status).toBe('SENT')
      expect(row.error).toBeNull()
      expect(row.leaseToken).toBeNull()
    }, 15_000)

    /**
     * Два незалежні процеси добивають ту саму партію покинутих рядків
     * одночасно — так виглядають два інстанси API, які прокинулися на тику
     * майже синхронно. Кожен рядок має стати `FAILED` рівно один раз: другий
     * `UPDATE` застає рядок уже не `PENDING` (перший його щойно забрав) і
     * просто не повертає його з `RETURNING` — без дублю, без падіння.
     */
    it('два одночасні reaper-воркери не дублюють і не губять жоден рядок', async () => {
      const ids = await Promise.all(
        ['lease-reap-race-1', 'lease-reap-race-2', 'lease-reap-race-3'].map(async (prefix) => {
          const id = await pendingDelivery(prefix)

          await prisma.notificationDelivery.update({
            where: { id },
            data: {
              attempts: MAX_DELIVERY_ATTEMPTS,
              leaseToken: `мертвий-${prefix}`,
              leaseUntil: new Date(Date.now() - 1000),
              nextAttemptAt: new Date(Date.now() - 1000),
            },
          })

          return id
        }),
      )

      const workerA = otherDispatcher()
      const workerB = otherDispatcher()

      await Promise.all([workerA.run(), workerB.run()])

      const rows = await Promise.all(ids.map((id) => rowOf(id)))

      for (const row of rows) {
        expect(row.status).toBe('FAILED')
        expect(row.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
        expect(row.leaseToken).toBeNull()
        expect(row.leaseUntil).toBeNull()
      }

      expect(sent).toHaveLength(0)
    })

    /**
     * Голий `Promise.all` вище перевіряє підсумок партії, але сам собою не
     * доводить перетин. Тут окрема транзакція тримає лок саме на delivery,
     * ОБИДВА реальні reaper-и стають за ним у чергу (доказ — два blocked
     * backend у `pg_stat_activity`), і лише після цього лок відпускається. Один
     * UPDATE повертає рядок і логує FAILED; другий після EvalPlanQual бачить уже
     * не PENDING і не повертає/не логує той самий delivery.
     */
    it('два reaper-и реально перетинаються, але RETURNING і structured log отримує один', async () => {
      const deliveryId = await pendingDelivery('lease-reap-race-barrier')
      const expired = new Date(Date.now() - 1000)

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: MAX_DELIVERY_ATTEMPTS,
          leaseToken: 'dead-reap-race',
          leaseUntil: expired,
          nextAttemptAt: expired,
        },
      })

      const barrier: Gate = { entered: deferred(), release: deferred() }
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "NotificationDelivery" WHERE "id" = ${deliveryId} FOR UPDATE
        `
        barrier.entered.resolve()
        await barrier.release.promise
      })

      await barrier.entered.promise

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation()
      const workerA = otherDispatcher()
      const workerB = otherDispatcher()

      try {
        const reapingA = workerA.run()
        const reapingB = workerB.run()

        await waitForBlockedBackend(prisma, { expectedCount: 2 })

        barrier.release.resolve()
        await holder
        await Promise.all([reapingA, reapingB])

        const row = await rowOf(deliveryId)

        expect(row.status).toBe('FAILED')
        expect(row.attempts).toBe(MAX_DELIVERY_ATTEMPTS)
        expect(row.leaseToken).toBeNull()
        expect(row.leaseUntil).toBeNull()
        expect(sent).toHaveLength(0)

        const logs = errorSpy.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes(deliveryId))

        expect(logs).toEqual([
          expect.stringMatching(/канал EMAIL, статус FAILED, спроба 5.*Спроби вичерпано/),
        ])
      } finally {
        barrier.release.resolve()
        await holder.catch(() => undefined)
        errorSpy.mockRestore()
      }
    }, 15_000)
  })

  /**
   * Дефект: `setInterval` викликав `this.inFlight = this.run()` НАПРЯМУ. Коли
   * тик перекривався з попереднім (той ще працює), `run()` бачив
   * `this.running === true`, миттєво повертав `0`, і САМЕ ЦЯ вже-виконана
   * обіцянка перезаписувала `inFlight` — тобто затирала посилання на
   * справжній активний тик. `onModuleDestroy()` тоді чекав би на порожню
   * обіцянку й завершувався б одразу, поки реальна робота ще триває і тримає
   * відкрите з'єднання.
   *
   * Тест відтворює це буквально: другий `wake()` викликається, поки перший ще
   * заблокований на гейті, — саме так виглядав би другий тик `setInterval`,
   * що застав перший неготовим. Фікс — `trigger()`, який не займає `inFlight`,
   * якщо тик уже виконується.
   */
  it('interval-style overlap не губить inFlight — shutdown чекає справжній активний тик', async () => {
    const deliveryId = await pendingDelivery('lease-overlap')
    const gate: Gate = { entered: deferred(), release: deferred() }

    gates.push(gate)

    const worker = otherDispatcher()

    // Перший «тик» інтервалу.
    worker.wake()
    await gate.entered.promise

    // Другий «тик» інтервалу застає перший ще активним. До фіксу це
    // присвоювало б `inFlight` вже виконаною обіцянкою.
    worker.wake()

    let stopped = false
    const stopping = worker.onModuleDestroy().then(() => {
      stopped = true
    })

    await Promise.resolve()
    // Якби `inFlight` підмінився швидкою обіцянкою другого «тику», shutdown
    // завершився б уже тут, поки перший тик і досі тримає рядок.
    expect(stopped).toBe(false)

    gate.release.resolve()
    await stopping

    expect(stopped).toBe(true)
    expect((await rowOf(deliveryId)).status).toBe('SENT')
  })

  /**
   * `onModuleDestroy` мусить дочекатися **справжнього** активного тику, а не
   * обіцянки, яка вже виконалася. Інакше зупинка застосунку лишає запити на
   * від'єднаному клієнті: у проді це шум у лозі при кожному деплої, у тестах —
   * «worker process has failed to exit gracefully».
   */
  it('зупинка дочекується активного тику', async () => {
    const deliveryId = await pendingDelivery('lease-shutdown')
    const gate: Gate = { entered: deferred(), release: deferred() }

    gates.push(gate)

    const worker = otherDispatcher()

    worker.wake()

    await gate.entered.promise

    let stopped = false
    const stopping = worker.onModuleDestroy().then(() => {
      stopped = true
    })

    // Тик ще триває — зупинка не має завершитися раніше за нього.
    await Promise.resolve()
    expect(stopped).toBe(false)

    gate.release.resolve()
    await stopping

    expect(stopped).toBe(true)
    expect((await rowOf(deliveryId)).status).toBe('SENT')
  })
})
