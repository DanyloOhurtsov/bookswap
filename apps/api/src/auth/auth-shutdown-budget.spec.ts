import { ShutdownBudget } from './auth-shutdown-budget'

/**
 * Годинник, яким керує тест: жодного `Date.now()`, жодного `setTimeout`.
 *
 * Саме тут і проходить межа між цим файлом і e2e-тестом
 * `auth-shutdown-reservation.e2e-spec.ts`. Арифметика спільного дедлайну —
 * твердження про КОД, і доводити його вимірюванням реальних затримок означало б
 * ставити зелений колір у залежність від того, наскільки завантажений CI.
 * Тут час рухається рівно тоді й рівно на стільки, скільки скаже тест; e2e
 * лишається smoke'ом, який доводить іншу річ — що прод-шлях справді бере числа
 * звідси.
 */
function fakeClock(startAt = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = startAt

  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

const TOTAL_MS = 30_000

describe('ShutdownBudget: один бюджет на всі фази зупинки', () => {
  it('на старті фаза бачить повний бюджет', () => {
    const clock = fakeClock()
    const budget = new ShutdownBudget(TOTAL_MS, clock.now)

    expect(budget.totalMs).toBe(TOTAL_MS)
    expect(budget.remainingMs()).toBe(TOTAL_MS)
  })

  it('дедлайн абсолютний і рахується один раз — від моменту створення', () => {
    const clock = fakeClock(1_000_000)
    const budget = new ShutdownBudget(TOTAL_MS, clock.now)

    expect(budget.deadlineAt).toBe(1_000_000 + TOTAL_MS)

    clock.advance(5_000)

    // Плин часу не рухає дедлайн — рухає лише залишок.
    expect(budget.deadlineAt).toBe(1_000_000 + TOTAL_MS)
  })

  it('після першої фази лишається рівно залишок, а не повний бюджет', () => {
    const clock = fakeClock()
    const budget = new ShutdownBudget(TOTAL_MS, clock.now)
    const spentInPhaseOne = 12_000

    clock.advance(spentInPhaseOne)

    expect(budget.remainingMs()).toBe(TOTAL_MS - spentInPhaseOne)
    expect(budget.remainingMs()).toBeLessThan(TOTAL_MS)
  })

  /**
   * Регресія, заради якої весь об'єкт і виділявся: стеля «на фазу» перетворила б
   * задокументовані тридцять секунд на шістдесят. Тест іде тим самим шляхом, що
   * й `onModuleDestroy`: спершу фаза `workflow` бере свій залишок, потім —
   * фаза `email`.
   */
  it('друга фаза ніколи не отримує свіжу повну стелю', () => {
    const clock = fakeClock()
    const budget = new ShutdownBudget(TOTAL_MS, clock.now)

    const workflowPhaseMs = budget.remainingMs()

    expect(workflowPhaseMs).toBe(TOTAL_MS)

    clock.advance(12_000)

    const emailPhaseMs = budget.remainingMs()

    expect(emailPhaseMs).toBe(TOTAL_MS - 12_000)
    expect(emailPhaseMs).toBeLessThan(TOTAL_MS)

    // Найголовніше: сума того, що фази взагалі мають право прочекати, не
    // перевищує одного бюджету — незалежно від кількості фаз.
    expect(12_000 + emailPhaseMs).toBe(TOTAL_MS)
  })

  it('залишок монотонно спадає й ніколи не зростає', () => {
    const clock = fakeClock()
    const budget = new ShutdownBudget(TOTAL_MS, clock.now)
    let previous = budget.remainingMs()

    for (let step = 0; step < 10; step += 1) {
      clock.advance(1_500)

      const current = budget.remainingMs()

      expect(current).toBeLessThanOrEqual(previous)
      previous = current
    }
  })

  it('після дедлайну залишок — нуль, а не від’ємне число', () => {
    const clock = fakeClock()
    const budget = new ShutdownBudget(TOTAL_MS, clock.now)

    clock.advance(TOTAL_MS)

    // Рівно на дедлайні чекати вже нема на що.
    expect(budget.remainingMs()).toBe(0)

    clock.advance(TOTAL_MS)

    // Від'ємний залишок `AuthService.settle` прочитав би як «чекати нема на
    // що» так само, але `setTimeout(-30000)` в іншій гілці спрацював би
    // негайно й тихо — тож межа зафіксована саме нулем.
    expect(budget.remainingMs()).toBe(0)
  })

  it('нульовий бюджет вичерпаний із самого початку', () => {
    const clock = fakeClock()
    const budget = new ShutdownBudget(0, clock.now)

    expect(budget.deadlineAt).toBe(clock.now())
    expect(budget.remainingMs()).toBe(0)
  })

  it('за замовчуванням годинник — системний', () => {
    const before = Date.now()
    const budget = new ShutdownBudget(TOTAL_MS)
    const after = Date.now()

    expect(budget.deadlineAt).toBeGreaterThanOrEqual(before + TOTAL_MS)
    expect(budget.deadlineAt).toBeLessThanOrEqual(after + TOTAL_MS)
  })
})
