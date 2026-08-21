/** Фаза auth-дренажу, яка не вклалася в загальний бюджет shutdown. */
export type AuthShutdownPhase = 'workflow' | 'email'

/**
 * Graceful shutdown не вдався: за відведений бюджет робота не завершилася.
 *
 * Кидається з `AuthService.onModuleDestroy`, тобто **виходить назовні з
 * `app.close()`**. Це навмисно: тайм-аут тут означає, що процес завершується з
 * незакінченою роботою — на фазі `workflow` в базі може лишитися напівдописаний
 * ланцюг, на фазі `email` — ненадісланий лист. Проковтнути це й доповісти
 * «зупинено штатно» означало б збрехати єдиному, хто ще може зреагувати:
 * оператору деплою.
 *
 * На реальному сигналі Nest 11 ловить помилку з `close()`, пише
 * `ERROR_DURING_SHUTDOWN` і **одразу викликає `process.exit(1)`** — тобто
 * невдалий drain видно і в логах, і в exit code, а не лише в тестах.
 *
 * З цього ж випливає межа, якої не варто плутати з гарантією: `process.exit(1)`
 * не чекає нічого, тож workflow, що на цей момент іще працював, обривається
 * посеред ланцюга окремих транзакцій — рівно як при аварійному завершенні. Ця
 * помилка означає «зупинка не вдалася, стан у базі може бути частковим», а не
 * «роботу все одно буде докінчено». Усунути це до кінця можна лише
 * transactional outbox або атомарнішим auth-workflow; в етапі 6 такого немає.
 *
 * Поля навмисно числові й перевіряються тестом: `budgetMs` — **загальний**
 * бюджет, `deadlineAt` — єдиний абсолютний дедлайн, спільний для всіх фаз,
 * `phaseBudgetMs` — скільки від нього лишалося цій фазі. `phaseBudgetMs`
 * менший за `budgetMs` — це і є доказ, що фаза не отримала власну повну стелю.
 */
export class AuthShutdownTimeoutError extends Error {
  constructor(
    readonly phase: AuthShutdownPhase,
    readonly pending: number,
    readonly budgetMs: number,
    readonly deadlineAt: number,
    readonly phaseBudgetMs: number,
  ) {
    super(
      `Graceful shutdown auth не вклався в ${String(budgetMs)} мс: ` +
        `фаза «${phase}» лишила незавершеними ${String(pending)} ` +
        `(на фазу лишалося ${String(phaseBudgetMs)} мс)`,
    )
    this.name = 'AuthShutdownTimeoutError'
  }
}
