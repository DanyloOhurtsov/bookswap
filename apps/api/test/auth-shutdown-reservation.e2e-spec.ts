import 'reflect-metadata'
import request from 'supertest'
import { API_ERROR_CODES, apiErrorSchema } from '@bookswap/shared'
import { createTestApp, sessionCookie, uniqueEmail, VALID_PASSWORD } from './auth.helpers'
import { beginRequest, deferred, gate } from './concurrency.helpers'
import { url } from './loan.helpers'
import { AuthShutdownTimeoutError } from '../src/auth/auth-shutdown-timeout.error'
import { AUTH_SHUTDOWN_TIMEOUT } from '../src/auth/auth.constants'
import { AuthService } from '../src/auth/auth.service'
import { EMAIL_SENDER } from '../src/email/email-sender'
import { PrismaService } from '../src/prisma/prisma.service'
import type { EmailMessage, EmailSender } from '../src/email/email-sender'
import type { INestApplication } from '@nestjs/common'
import type { App } from 'supertest/types'

/**
 * Дефект: 503 приходив ПІСЛЯ частково закомічених auth side effects.
 *
 * Стара схема відстежувала лише фоновий лист. `register()` устигав створити
 * `User`, потім записати токен підтвердження — і аж тоді впиралася в закритий
 * gate: запит падав із 503, сесія не створювалася, а повторна реєстрація тим
 * самим email давала `EMAIL_TAKEN`. Акаунт лишався створеним, але без сесії й
 * без листа підтвердження, а інтерфейс щойно сказав, що реєстрація не вдалася.
 * (Увійти таким акаунтом технічно було можна — логін не вимагає
 * `emailVerified`, — але тільки здогадавшись спробувати.)
 *
 * Тепер одиниця обліку — увесь workflow, а не лист. Дозвіл (`reserveWorkflow`)
 * береться синхронно ДО першої мутації, а `onModuleDestroy` працює у двох
 * фазах під ОДНИМ абсолютним дедлайном: спершу перестає видавати дозволи, потім
 * чекає вже видані, і лише потім закриває та дренує чергу листів. Тести нижче
 * фіксують межу між «відхилено до записів» і «прийнято — отже, shutdown
 * зобов'язаний його дочекатися», а D і E — поведінку на вичерпаному бюджеті.
 *
 * **Чого ці тести НЕ доводять.** «Прийнятий workflow буде завершено» вірне лише
 * доти, доки graceful drain укладається в бюджет. Тут `app.close()` викликає сам
 * тест, і після його rejection процес живе далі — саме тому D і бачить, як
 * запізнілий workflow спокійно доходить до 201. У проді за тим самим rejection
 * стоїть Nest 11: він пише `ERROR_DURING_SHUTDOWN` і **одразу викликає
 * `process.exit(1)`**. Процес виходить із ненульовим кодом, нікого не
 * дочекавшись, а незавершений ланцюг окремих транзакцій лишає в базі часткові
 * side effects — рівно як при аварійному завершенні. Fail-loud policy дає рівно
 * одну гарантію: тайм-аут не маскується під успішний drain. Усунути ризик до
 * кінця може лише transactional outbox або атомарніший auth-workflow; в етапі 6
 * такого немає, і ці тести його не імітують.
 *
 * Кожен тест піднімає ОКРЕМИЙ застосунок (`close()` незворотний). Спільний
 * `verifyApp` — окреме, завжди відкрите з'єднання до тієї самої тестової бази:
 * стан читається ПІСЛЯ того, як застосунок під тестом уже закрився разом зі
 * своїм Prisma-клієнтом.
 */
/**
 * Запас на те, що тест засікає `Date.now()` ЗОВНІ `app.close()`, а сервіс
 * рахує дедлайн уже всередині хука — між цими двома точками минає трохи часу
 * (в нормі одиниці мілісекунд, під навантаженим CI — десятки). Запас мусить
 * лишатися помітно меншим за бюджет, інакше перестане відрізняти спільний
 * дедлайн від «свіжа стеля кожній фазі»; у тестах нижче він близько чверті
 * бюджету.
 */
const CLOCK_SLACK_MS = 400

/**
 * Наскільки виміряні тестом тривалості можуть розійтися з тим, що порахував
 * сервіс.
 *
 * Величина навмисно щедра: цей файл — smoke, а не вимірювальний прилад.
 * Точні числа спільного дедлайну доводить `src/auth/auth-shutdown-budget.spec.ts`
 * фейковим годинником, без wall-clock узагалі; тут перевіряється лише те, що
 * прод-шлях справді бере їх звідти, а не рахує собі стелю на фазу. Запас
 * підібраний так, щоб обидві альтернативні гіпотези («фаза отримала повний
 * бюджет заново» і «фаза отримала нуль») лишалися за його межами із запасом не
 * меншим за нього самого — інакше він розмив би саме те, що тест доводить.
 */
const TIMING_MARGIN_MS = 1_000

/**
 * Справжня затримка, а не бар'єр.
 *
 * У решті файлу час — це те, чим керує тест; у тестах D і E час — це те, що
 * тест ПЕРЕВІРЯЄ (як shutdown ділить бюджет між фазами). Підмінити його там
 * означало б перевіряти не ту механіку, яку обіцяно.
 */
const waitMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('Auth-workflow і двофазний shutdown gate (e2e)', () => {
  let verifyApp: INestApplication<App>
  let prisma: PrismaService

  beforeAll(async () => {
    verifyApp = await createTestApp()
    prisma = verifyApp.get(PrismaService)
  })

  afterAll(async () => {
    await verifyApp.close()
  })

  interface Harness {
    app: INestApplication<App>
    auth: AuthService
    sent: EmailMessage[]
    /** Дозволяє мок-провайдеру пошти зупинитися рівно всередині `send()`. */
    holdEmail: (held: ReturnType<typeof gate>) => void
  }

  async function bootApp(shutdownTimeoutMs?: number): Promise<Harness> {
    const sent: EmailMessage[] = []
    let held: ReturnType<typeof gate> | null = null
    const emailSender: EmailSender = {
      send(message) {
        if (held === null) {
          sent.push(message)

          return Promise.resolve()
        }

        const current = held

        current.entered.resolve()

        return current.release.promise.then(() => {
          sent.push(message)
        })
      },
    }

    const app = await createTestApp({
      configure: (builder) => {
        builder.overrideProvider(EMAIL_SENDER).useValue(emailSender)

        // Бюджет підміняється саме через DI — тим самим шляхом, яким його бере
        // прод. Фейкові таймери навколо реального `app.close()` перевіряли б
        // іншу механіку, а тридцять секунд справжнього очікування в тесті
        // ніхто б не терпів.
        if (shutdownTimeoutMs !== undefined) {
          builder.overrideProvider(AUTH_SHUTDOWN_TIMEOUT).useValue(shutdownTimeoutMs)
        }
      },
    })

    return {
      app,
      auth: app.get(AuthService),
      sent,
      holdEmail: (next) => {
        held = next
      },
    }
  }

  /**
   * Зупиняє реальний `app.close()` одразу ПІСЛЯ повного auth-дренажу, не
   * чіпаючи його логіки: обидві фази відпрацьовують по-справжньому, а вже потім
   * hook висить на `resume`, поки HTTP-сервер іще приймає запити (Nest закриває
   * сервер лише після всіх `onModuleDestroy`).
   *
   * Саме це вікно й потрібне тестам A і C: gate уже закритий і черга вже
   * остаточно порожня — тобто перевіряється не «встигли до», а справжній
   * післядренажний стан, у якому жодне нове завдання не має права стартувати.
   */
  function holdAfterDrain(auth: AuthService): {
    drained: Promise<void>
    resume: () => void
  } {
    const drained = deferred()
    const resume = deferred()
    const original = auth.onModuleDestroy.bind(auth)

    jest.spyOn(auth, 'onModuleDestroy').mockImplementation(async () => {
      await original()
      drained.resolve()
      await resume.promise
    })

    return { drained: drained.promise, resume: resume.resolve }
  }

  /**
   * Зупиняє `app.close()` рівно там, де закритий **workflow**-gate, а дренаж —
   * ні.
   *
   * Гейтів у сервісі два, і сигнал стосується першого з них. `acceptingWorkflows`
   * знімається синхронно, до першого `await` у `onModuleDestroy`, тож повернення
   * з виклику вже означає «нових workflow не приймаємо». Другий gate,
   * `acceptingEmailJobs`, у цей момент **іще відкритий**: він закривається аж
   * після того, як фаза 1 дочекається всіх виданих дозволів. Саме на цій
   * різниці тримається тест B — прийнятий раніше workflow ставить свій лист у
   * ВІДКРИТУ чергу вже після того, як нових його ровесників приймати перестали.
   */
  function signalWorkflowGateClosed(auth: AuthService): Promise<void> {
    const closed = deferred()
    const original = auth.onModuleDestroy.bind(auth)

    jest.spyOn(auth, 'onModuleDestroy').mockImplementation(() => {
      const running = original()

      closed.resolve()

      return running
    })

    return closed.promise
  }

  async function registerVia(
    app: INestApplication<App>,
    prefix: string,
  ): Promise<{ id: string; email: string; cookie: string }> {
    const address = uniqueEmail(prefix)
    const response = await request(app.getHttpServer())
      .post(url('/auth/register'))
      .send({ email: address, password: VALID_PASSWORD, displayName: 'Зупинка' })
      .expect(201)

    return {
      id: (response.body as { user: { id: string } }).user.id,
      email: address,
      cookie: sessionCookie(response.headers),
    }
  }

  /** A. Gate закрито ДО register: жодного side effect, чесний 503. */
  it('A: register після закриття gate відхиляється до будь-яких записів у БД', async () => {
    const { app, auth, sent } = await bootApp()
    const warnSpy = jest.spyOn(auth['logger'], 'warn').mockImplementation()
    const { drained, resume } = holdAfterDrain(auth)
    let closing: Promise<void> | undefined

    try {
      closing = app.close()

      // Обидві фази дренажу вже позаду — далі не має стартувати нічого.
      await drained

      const address = uniqueEmail('shutdown-rejected')
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: address, password: VALID_PASSWORD, displayName: 'Пізно' })

      expect(response.status).toBe(503)
      expect(apiErrorSchema.parse(response.body).code).toBe(API_ERROR_CODES.INTERNAL_ERROR)
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('відхилено'))).toBe(true)

      // Жодного невідстежуваного листа після terminal drain.
      expect(sent).toHaveLength(0)

      // І — головне — жодного сліду в базі: ні User, ні токена, ні сесії.
      expect(await prisma.user.findUnique({ where: { email: address } })).toBeNull()
      expect(
        await prisma.emailVerificationToken.count({ where: { user: { email: address } } }),
      ).toBe(0)
      expect(await prisma.session.count({ where: { user: { email: address } } })).toBe(0)

      resume()
      await closing
    } finally {
      resume()

      if (closing === undefined) await app.close().catch(() => undefined)
      else await closing.catch(() => undefined)

      warnSpy.mockRestore()
    }
  }, 20_000)

  /**
   * B. Дозвіл узято ДО shutdown — отже, drain його дочікується.
   *
   * Бар'єр стоїть на `emailVerificationToken.create()`: `User` уже закомічений,
   * лист іще не поставлено в чергу. Саме в цій точці стара реалізація віддавала
   * 503. Тепер тут відбувається протилежне: `app.close()` мусить дочекатися і
   * самого workflow, і листа, який той поставить уже після закриття
   * **workflow**-gate — але ще у ВІДКРИТУ чергу листів (email-gate до кінця
   * фази 1 не чіпають, див. `signalWorkflowGateClosed`).
   *
   * Бюджет тут стандартні тридцять секунд і не вичерпується — тобто це та сама
   * умова, за якої обіцянка «прийнятий workflow буде завершено» взагалі чинна.
   * Що буває, коли бюджету не вистачає, — у D і E та в коментарі до файлу.
   */
  it('B: register, що отримав reservation до shutdown, завершується узгоджено без 503', async () => {
    const { app, auth, sent, holdEmail } = await bootApp()
    const appPrisma = app.get(PrismaService)
    const tokenBarrier = gate()
    const heldEmail = gate()
    const originalCreate = appPrisma.emailVerificationToken.create.bind(
      appPrisma.emailVerificationToken,
    )
    const tokenSpy = jest
      .spyOn(appPrisma.emailVerificationToken, 'create')
      .mockImplementationOnce((async (args: never) => {
        tokenBarrier.entered.resolve()
        await tokenBarrier.release.promise

        return originalCreate(args)
      }) as never)
    const workflowGateClosed = signalWorkflowGateClosed(auth)
    const address = uniqueEmail('shutdown-reserved')
    let closing: Promise<void> | undefined

    try {
      const inFlight = beginRequest(
        request(app.getHttpServer())
          .post(url('/auth/register'))
          .send({ email: address, password: VALID_PASSWORD, displayName: 'Вчасно' }),
      )

      // Запит уже в середині workflow: дозвіл на руках, User записаний, токена
      // ще немає. Читаємо стороннім з'єднанням — це саме той «частково
      // закомічений» стан, на якому раніше прилітав 503.
      await tokenBarrier.entered.promise
      expect(await prisma.user.findUnique({ where: { email: address } })).not.toBeNull()

      // Лист цього workflow має зупинитися всередині провайдера — інакше він
      // проскочить раніше, ніж ми встигнемо довести, що shutdown його чекає.
      holdEmail(heldEmail)

      let closed = false

      closing = app.close().then(() => {
        closed = true
      })

      // Фаза 1: закрито саме **workflow**-gate — нових дозволів більше не
      // видають, наш уже на руках. Email-gate (`acceptingEmailJobs`) у цю мить
      // ще ВІДКРИТИЙ: він закривається лише після дренажу фази 1, тобто після
      // того, як наш workflow дійде до кінця й поставить свій лист.
      await workflowGateClosed
      expect(closed).toBe(false)

      tokenBarrier.release.resolve()

      const response = await inFlight

      // Жодного 503 після записаного User: workflow дописав токен, поставив
      // лист і створив сесію вже за закритим gate.
      expect(response.status).toBe(201)
      expect(sessionCookie(response.headers)).toContain('bookswap_session=')

      // Фаза 3: лист справді очікується shutdown'ом, а не покидається.
      await heldEmail.entered.promise
      await Promise.resolve()
      expect(closed).toBe(false)

      heldEmail.release.resolve()
      await closing

      expect(closed).toBe(true)
      expect(sent).toHaveLength(1)
      expect(sent[0]?.to).toBe(address)

      const user = await prisma.user.findUniqueOrThrow({ where: { email: address } })

      expect(user.emailVerified).toBe(false)

      const tokens = await prisma.emailVerificationToken.findMany({ where: { userId: user.id } })

      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.usedAt).toBeNull()

      const sessions = await prisma.session.findMany({ where: { userId: user.id } })

      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.revokedAt).toBeNull()
    } finally {
      tokenBarrier.release.resolve()
      heldEmail.release.resolve()

      if (closing === undefined) await app.close().catch(() => undefined)
      else await closing.catch(() => undefined)

      tokenSpy.mockRestore()
    }
  }, 20_000)

  /** C. Те саме для решти двох входів: resend і скидання пароля. */
  it('C: resend і password-reset після закриття gate не роблять записів у БД', async () => {
    const { app, auth, sent } = await bootApp()
    let closing: Promise<void> | undefined
    let warnSpy: jest.SpyInstance | undefined
    let resume = (): void => undefined

    try {
      const account = await registerVia(app, 'shutdown-resend')

      // Реєстрація вище сама поставила лист — дочікуємося його явно, щоб далі
      // порожній `sent` означав саме «нічого нового не пішло».
      await auth.drainBackgroundWork()
      sent.length = 0

      const verificationBefore = await prisma.emailVerificationToken.count({
        where: { userId: account.id },
      })

      expect(verificationBefore).toBe(1)

      warnSpy = jest.spyOn(auth['logger'], 'warn').mockImplementation()

      const held = holdAfterDrain(auth)

      resume = held.resume
      closing = app.close()
      await held.drained

      const resend = await request(app.getHttpServer())
        .post(url('/auth/email-verification'))
        .set('Cookie', account.cookie)

      expect(resend.status).toBe(503)
      expect(apiErrorSchema.parse(resend.body).code).toBe(API_ERROR_CODES.INTERNAL_ERROR)

      const reset = await request(app.getHttpServer())
        .post(url('/auth/password-reset'))
        .send({ email: account.email })

      expect(reset.status).toBe(503)
      expect(apiErrorSchema.parse(reset.body).code).toBe(API_ERROR_CODES.INTERNAL_ERROR)

      expect(sent).toHaveLength(0)

      // Жодного нового токена підтвердження і жодного токена скидання: обидва
      // входи відмовили ДО запису, а не після нього.
      expect(await prisma.emailVerificationToken.count({ where: { userId: account.id } })).toBe(
        verificationBefore,
      )
      expect(await prisma.passwordResetToken.count({ where: { userId: account.id } })).toBe(0)

      resume()
      await closing
    } finally {
      resume()

      if (closing === undefined) await app.close().catch(() => undefined)
      else await closing.catch(() => undefined)

      warnSpy?.mockRestore()
    }
  }, 20_000)

  /**
   * D. Бюджет вичерпано на живому workflow — і це НЕ успішна зупинка.
   *
   * Найспокусливіша реалізація тут — залогувати «стеля вичерпана» і піти далі
   * штатним шляхом. Вона й ламає все інше: наступним рядком закривається
   * email-gate, і workflow, який усе ще працює (і вже створив `User` та токен),
   * упирається в нього на `enqueueEmail` — тобто отримує відмову ПІСЛЯ
   * незворотних записів, рівно той дефект, який ці тести й закривають.
   *
   * Тому політика така: фаза 1 на тайм-ауті кидає `AuthShutdownTimeoutError`,
   * нічого після себе не виконує, а виданий дозвіл лишається чинним. Тест
   * доводить обидві половини — і гучну відмову `app.close()`, і те, що
   * запізнілий workflow усе одно доходить до кінця без 503.
   *
   * Друга половина — властивість ЦЬОГО процесу, а не прода: тут після rejection
   * ніхто не викликає `process.exit`, тож workflow має час дописатися. У проді
   * Nest на цьому місці виходить кодом 1 негайно, і той самий workflow
   * обірветься з частковими side effects — див. коментар до файлу.
   */
  it('D: тайм-аут на живому workflow валить app.close() і не чіпає email-gate', async () => {
    const budgetMs = 1_600
    const { app, auth, sent } = await bootApp(budgetMs)
    const appPrisma = app.get(PrismaService)
    const tokenBarrier = gate()
    const originalCreate = appPrisma.emailVerificationToken.create.bind(
      appPrisma.emailVerificationToken,
    )
    const tokenSpy = jest
      .spyOn(appPrisma.emailVerificationToken, 'create')
      .mockImplementationOnce((async (args: never) => {
        tokenBarrier.entered.resolve()
        await tokenBarrier.release.promise

        return originalCreate(args)
      }) as never)
    const logSpy = jest.spyOn(auth['logger'], 'log').mockImplementation()
    const errorSpy = jest.spyOn(auth['logger'], 'error').mockImplementation()
    const address = uniqueEmail('shutdown-timeout')

    try {
      const inFlight = beginRequest(
        request(app.getHttpServer())
          .post(url('/auth/register'))
          .send({ email: address, password: VALID_PASSWORD, displayName: 'Затримка' }),
      )

      // Дозвіл на руках, `User` уже в базі, до `enqueueEmail` іще далеко.
      await tokenBarrier.entered.promise

      const closeStartedAt = Date.now()
      // Гонка з таймером — не «на всяк випадок», а заради діагностики: реалізація,
      // що проковтує тайм-аут, іде далі до `dispose()`, а той чекає ще й на
      // незакриті HTTP-з'єднання — тобто `app.close()` просто зависає. Без цієї
      // гонки регресія виглядала б як «тест упав по 30-секундному тайм-ауту»
      // замість зрозумілого «зупинка не завершилася».
      const failure: unknown = await Promise.race([
        app.close().then(
          () => 'resolved' as const,
          (error: unknown) => error,
        ),
        waitMs(4 * budgetMs).then(() => 'pending' as const),
      ])
      const elapsed = Date.now() - closeStartedAt

      // 1. Зупинка провалилася голосно, а не тихо — і не зависла.
      expect(failure).not.toBe('pending')
      expect(failure).not.toBe('resolved')
      expect(failure).toBeInstanceOf(AuthShutdownTimeoutError)

      const timeout = failure as AuthShutdownTimeoutError

      expect(timeout.phase).toBe('workflow')
      expect(timeout.pending).toBe(1)

      // 2. Дедлайн один і порахований із ЗАГАЛЬНОГО бюджету на старті зупинки.
      expect(timeout.budgetMs).toBe(budgetMs)
      expect(timeout.deadlineAt).toBeGreaterThanOrEqual(closeStartedAt)
      expect(timeout.deadlineAt).toBeLessThanOrEqual(closeStartedAt + budgetMs + CLOCK_SLACK_MS)
      expect(timeout.phaseBudgetMs).toBeLessThanOrEqual(budgetMs)

      // 3. Сумарне очікування — один бюджет, а не бюджет на фазу.
      expect(elapsed).toBeLessThan(2 * budgetMs)

      // 4. Жодного неправдивого success-log і жодного руху далі по фазах.
      const logs = logSpy.mock.calls.map((call) => String(call[0]))

      expect(logs.some((line) => line.includes('усі прийняті workflow завершено'))).toBe(false)
      expect(logs.some((line) => line.includes('auth-email: gate закрито'))).toBe(false)
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('не вклався'))).toBe(true)

      // 5. Найголовніше: gate під живим workflow не закрився, тож запізнілий
      //    workflow доходить до кінця — 201, а не 503 після створеного User.
      tokenBarrier.release.resolve()

      const response = await inFlight

      expect(response.status).toBe(201)
      expect(sessionCookie(response.headers)).toContain('bookswap_session=')

      await auth.drainBackgroundWork()

      expect(sent).toHaveLength(1)
      expect(sent[0]?.to).toBe(address)

      // 6. Стан узгоджений: не буває ні User без токена, ні User без сесії.
      const user = await prisma.user.findUniqueOrThrow({ where: { email: address } })

      expect(await prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(1)
      expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1)

      // Друга спроба зупинки — вже без живої роботи — має пройти штатно.
      await app.close()
    } finally {
      tokenBarrier.release.resolve()
      await app.close().catch(() => undefined)
      tokenSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  }, 30_000)

  /**
   * E. Smoke: прод-шлях справді ділить ОДИН бюджет між фазами.
   *
   * Розподіл поділено між двома тестами навмисно. Саму арифметику спільного
   * дедлайну доводить `src/auth/auth-shutdown-budget.spec.ts` — фейковим
   * годинником, без жодного `setTimeout`: повний бюджет на старті, залишок
   * після першої фази, нуль після дедлайну, і жодної свіжої повної стелі другій
   * фазі. Раніше все це трималося лише тут, на затримці 300 мс усередині
   * бюджету 600 мс, — тобто зелений колір залежав від того, наскільки
   * завантажений CI.
   *
   * Цьому тесту лишається інше твердження, якого unit-тест дати не може:
   * `onModuleDestroy` дійсно бере числа з того об'єкта, а не рахує стелю на
   * фазу в себе. Тому тут обидві фази виконуються по-справжньому (workflow
   * завершується, з'ївши помітну частину бюджету, а лист зависає назавжди), а
   * межі — широкі: перевіряється форма розподілу, а не мілісекунди.
   *
   * Чотири твердження, і кожне відкидає свою альтернативну гіпотезу:
   *   1. `phaseBudgetMs > 0` — фаза 2 не отримала нуль (інакше «фаза 2 взагалі
   *      не чекала» проходило б як успіх);
   *   2. `phaseBudgetMs < budgetMs` — і не отримала повну стелю заново;
   *   3. `phaseBudgetMs ≈ budgetMs − elapsedFirstPhase`, де `elapsedFirstPhase`
   *      виміряний НЕЗАЛЕЖНО (від старту `close()` до відповіді 201) — тобто
   *      залишок справді дорівнює тому, що лишилося, а не якомусь іншому числу
   *      між нулем і бюджетом;
   *   4. сумарний `elapsed ≈ один бюджет`, а не «затримка + повний бюджет».
   *
   * Затримка навмисно справжня (`setTimeout`), а не бар'єрна: тут перевіряється
   * саме поведінка в часі, тож підмінити час означало б перевіряти не те, що
   * обіцяно.
   */
  it('E (smoke): бюджет один на всі фази — фаза 2 отримує лише залишок', async () => {
    const budgetMs = 4_000
    // Помітна, але безпечна частка бюджету: фаза 1 має і з'їсти достатньо, щоб
    // «залишок» відрізнявся від «повного бюджету» більш ніж на TIMING_MARGIN_MS,
    // і лишити собі стільки ж запасу на повільний CI, щоб не впертися у власний
    // тайм-аут (тоді phase був би 'workflow', і тест упав би змістовно).
    const spentInPhaseOne = 2_000
    const { app, auth, holdEmail } = await bootApp(budgetMs)
    const appPrisma = app.get(PrismaService)
    const tokenBarrier = gate()
    const heldEmail = gate()
    const originalCreate = appPrisma.emailVerificationToken.create.bind(
      appPrisma.emailVerificationToken,
    )
    const tokenSpy = jest
      .spyOn(appPrisma.emailVerificationToken, 'create')
      .mockImplementationOnce((async (args: never) => {
        tokenBarrier.entered.resolve()
        await tokenBarrier.release.promise

        return originalCreate(args)
      }) as never)
    const errorSpy = jest.spyOn(auth['logger'], 'error').mockImplementation()
    const address = uniqueEmail('shutdown-budget')

    try {
      const inFlight = beginRequest(
        request(app.getHttpServer())
          .post(url('/auth/register'))
          .send({ email: address, password: VALID_PASSWORD, displayName: 'Бюджет' }),
      )

      await tokenBarrier.entered.promise
      holdEmail(heldEmail)

      const closeStartedAt = Date.now()
      const closing = app.close().then(
        () => null,
        (error: unknown) => error,
      )

      // Фаза 1 з'їдає відому частину спільного бюджету, після чого workflow
      // завершується штатно й ставить лист, який уже нікуди не долетить.
      setTimeout(() => {
        tokenBarrier.release.resolve()
      }, spentInPhaseOne)

      expect((await inFlight).status).toBe(201)

      // Незалежний вимір фази 1: відповідь 201 приходить одразу після того, як
      // workflow звільнив дозвіл, тобто після кінця фази 1. Це верхня оцінка —
      // саме тому нижче стоїть двостороння смуга, а не рівність.
      const observedPhaseOneMs = Date.now() - closeStartedAt

      const failure: unknown = await closing
      const elapsed = Date.now() - closeStartedAt

      expect(failure).toBeInstanceOf(AuthShutdownTimeoutError)

      const timeout = failure as AuthShutdownTimeoutError

      // Фаза 2 дійсно виконувалася — і саме вона вперлася в спільний дедлайн.
      expect(timeout.phase).toBe('email')
      expect(timeout.budgetMs).toBe(budgetMs)
      expect(timeout.deadlineAt).toBeLessThanOrEqual(closeStartedAt + budgetMs + CLOCK_SLACK_MS)

      // 1. Фаза 2 отримала НЕНУЛЬОВИЙ залишок. Без цього рядка реалізація, у
      //    якій фаза 2 не чекає взагалі, дала б такий самий 'email'-тайм-аут і
      //    тест лишався б зеленим.
      expect(timeout.phaseBudgetMs).toBeGreaterThan(0)

      // 2. І не отримала повну стелю заново.
      expect(timeout.phaseBudgetMs).toBeLessThan(budgetMs)

      // 3. Залишок — це саме «бюджет мінус з'їдене фазою 1», а не довільне
      //    число між нулем і бюджетом. `observedPhaseOneMs` завищений (відповідь
      //    приходить трохи пізніше за кінець фази), тому очікуване значення —
      //    нижня оцінка залишку, і смуга розсунута в обидва боки.
      const expectedPhaseBudgetMs = budgetMs - observedPhaseOneMs

      expect(timeout.phaseBudgetMs).toBeGreaterThanOrEqual(expectedPhaseBudgetMs - TIMING_MARGIN_MS)
      expect(timeout.phaseBudgetMs).toBeLessThanOrEqual(expectedPhaseBudgetMs + TIMING_MARGIN_MS)

      // 4. Сумарне очікування — ОДИН бюджет, а не «затримка + повний бюджет».
      //    Друга гіпотеза дала б ≈ spentInPhaseOne + budgetMs, і вона лишається
      //    за верхньою межею з запасом, більшим за сам TIMING_MARGIN_MS.
      expect(elapsed).toBeGreaterThanOrEqual(budgetMs - TIMING_MARGIN_MS)
      expect(elapsed).toBeLessThanOrEqual(budgetMs + TIMING_MARGIN_MS)
      expect(elapsed).toBeLessThan(observedPhaseOneMs + budgetMs)

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('не вклався'))).toBe(true)
    } finally {
      tokenBarrier.release.resolve()
      heldEmail.release.resolve()
      await app.close().catch(() => undefined)
      tokenSpy.mockRestore()
      errorSpy.mockRestore()
    }
  }, 30_000)
})
