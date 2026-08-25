import {
  displayDecision,
  requestKey,
  schemaIdOf,
  visibleData,
  visibleState,
  type ResourceSnapshot,
  type ResourceState,
} from './resource-state'

/**
 * Регресії на ідентичність запиту.
 *
 * Обидва сценарії нижче — це той самий клас помилки: ключ, складений лише з
 * `nonce + path`, збігався для різних запитів, і хук віддавав стару відповідь як
 * свіжу. Тести чисті: жодного рендерингу, jsdom чи бібліотек — лише правило.
 */

const schemaA = { name: 'libraryResponseSchema' }
const schemaB = { name: 'borrowedLibraryResponseSchema' }

const ready = (data: string): ResourceSnapshot<string> => ({
  key: '',
  generation: 0,
  state: { status: 'ready', data },
})

describe('schemaIdOf', () => {
  it('той самий обʼєкт — той самий номер', () => {
    expect(schemaIdOf(schemaA)).toBe(schemaIdOf(schemaA))
  })

  it('різні обʼєкти — різні номери', () => {
    expect(schemaIdOf(schemaA)).not.toBe(schemaIdOf(schemaB))
  })
})

describe('requestKey', () => {
  it('розрізняє шляхи', () => {
    expect(requestKey(0, schemaA, '/a')).not.toBe(requestKey(0, schemaA, '/b'))
  })

  it('розрізняє reload на тому самому шляху', () => {
    expect(requestKey(0, schemaA, '/a')).not.toBe(requestKey(1, schemaA, '/a'))
  })

  it('розрізняє схеми на тому самому шляху', () => {
    // Без цього зміна схеми лишала ключ незмінним, і один рендер устигав
    // показати відповідь, розібрану ІНШИМ контрактом, як актуальну.
    expect(requestKey(0, schemaA, '/a')).not.toBe(requestKey(0, schemaB, '/a'))
  })

  it('однакові входи — однаковий ключ', () => {
    expect(requestKey(0, schemaA, '/a')).toBe(requestKey(0, schemaA, '/a'))
  })
})

describe('visibleState', () => {
  it('без сліду — завантаження', () => {
    expect(visibleState(null, 'k', 1)).toEqual({ status: 'loading' })
  })

  it('слід від поточного покоління й тих самих входів — його стан', () => {
    const snapshot = { ...ready('A'), key: 'k', generation: 3 }

    expect(visibleState(snapshot, 'k', 3)).toEqual({ status: 'ready', data: 'A' })
  })

  it('входи змінилися, ефект ще не стартував — завантаження', () => {
    // Покоління те саме (ефект ще не спрацював), рятує лише перевірка ключа.
    const snapshot = { ...ready('A'), key: 'k-a', generation: 1 }

    expect(visibleState(snapshot, 'k-b', 1)).toEqual({ status: 'loading' })
  })

  it('помилка теж належить своєму поколінню', () => {
    const snapshot: ResourceSnapshot<string> = {
      key: 'k',
      generation: 2,
      state: { status: 'error', message: 'збій' },
    }

    expect(visibleState(snapshot, 'k', 2)).toEqual({ status: 'error', message: 'збій' })
    expect(visibleState(snapshot, 'k', 3)).toEqual({ status: 'loading' })
  })

  /**
   * Головна регресія: A → B → A.
   *
   * Ключ другого A дослівно збігається з ключем першого, тож перевірки ключа
   * замало — саме тут старий варіант віддавав дані першого A, поки другий іще
   * летів.
   */
  it('A → B → A не показує дані першого A, поки другий не завершився', () => {
    const keyA = requestKey(0, schemaA, '/users/1/library')
    const keyB = requestKey(0, schemaA, '/users/2/library')

    // 1. A завантажився: покоління 1.
    let snapshot: ResourceSnapshot<string> = {
      key: keyA,
      generation: 1,
      state: { status: 'ready', data: 'A' },
    }

    expect(visibleState(snapshot, keyA, 1)).toEqual({ status: 'ready', data: 'A' })

    // 2. Перейшли на B — ефект B стартував, покоління 2. B ще не приїхав.
    expect(visibleState(snapshot, keyB, 2)).toEqual({ status: 'loading' })

    // 3. Повернулися на A до завершення B: ключ знову keyA, але покоління вже 3.
    expect(visibleState(snapshot, keyA, 3)).toEqual({ status: 'loading' })

    // 4. І лише коли другий A справді завершився — його дані.
    snapshot = { key: keyA, generation: 3, state: { status: 'ready', data: 'A-fresh' } }

    expect(visibleState(snapshot, keyA, 3)).toEqual({ status: 'ready', data: 'A-fresh' })
  })

  it('зміна схеми на тому самому шляху не показує попередню відповідь', () => {
    const path = '/me/library'
    const keyWithA = requestKey(0, schemaA, path)
    const keyWithB = requestKey(0, schemaB, path)
    const snapshot: ResourceSnapshot<string> = {
      key: keyWithA,
      generation: 1,
      state: { status: 'ready', data: 'own' },
    }

    // Ключ уже інший — стара відповідь не проходить навіть до того, як ефект
    // із новою схемою встиг збільшити покоління.
    expect(visibleState(snapshot, keyWithB, 1)).toEqual({ status: 'loading' })
    expect(visibleState(snapshot, keyWithB, 2)).toEqual({ status: 'loading' })
  })

  it('reload на тому самому шляху теж дає завантаження до завершення', () => {
    const before = requestKey(0, schemaA, '/loans')
    const after = requestKey(1, schemaA, '/loans')
    const snapshot: ResourceSnapshot<string> = {
      key: before,
      generation: 1,
      state: { status: 'ready', data: 'stale' },
    }

    expect(visibleState(snapshot, after, 2)).toEqual({ status: 'loading' })
  })
})

/**
 * §4 дефекту UI (налаштування сповіщень): `visibleState` навмисно віддає
 * `loading` на кожен `reload()`, а не лише на перший показ — сторінка, яка
 * звіряється тільки зі `status`, змушена або розмонтовувати форму на кожне
 * фонове оновлення (і губити локальний стан усередині, разом із deep link
 * на бота), або показувати старі дані, не розрізняючи «перший показ» і
 * «оновлюю те, що вже показано». `visibleData` — саме ця відсутня різниця.
 */
describe('visibleData', () => {
  it('ready — віддає нові дані', () => {
    const state: ResourceState<string> = { status: 'ready', data: 'нові' }

    expect(visibleData(state, 'старі')).toBe('нові')
  })

  /**
   * «Перевірити, чи спрацював Start» на ще НЕ підключеному акаунті: reload()
   * стартував (`status: 'loading'`), а попередні дані (з `connected: false`)
   * мають лишитися на екрані — інакше форма, разом із запрошеним deep link,
   * зникає на секунду й губить його.
   */
  it('loading, є попередні дані — віддає попередні, а не порожнечу', () => {
    const state: ResourceState<string> = { status: 'loading' }

    expect(visibleData(state, 'ще чинні')).toBe('ще чинні')
  })

  it('loading, попередніх даних нема (перший запит) — undefined', () => {
    const state: ResourceState<string> = { status: 'loading' }

    expect(visibleData(state, undefined)).toBeUndefined()
  })

  it('error, є попередні дані — попередні дані все одно видно', () => {
    const state: ResourceState<string> = { status: 'error', message: 'мережа впала' }

    expect(visibleData(state, 'ще чинні')).toBe('ще чинні')
  })

  it('error, попередніх даних нема — undefined', () => {
    const state: ResourceState<string> = { status: 'error', message: 'мережа впала' }

    expect(visibleData(state, undefined)).toBeUndefined()
  })
})

/**
 * §5 дефекту UI (налаштування сповіщень): рішення «форма + deepLink чи
 * помилка» зведене в одну функцію саме тому, що ці два стани раніше
 * перевірялися нарізно й розходилися — `visibleData` уже не показувала б
 * порожню сторінку на фоновому reload(), але сторінка все одно НІЯК не
 * реагувала на `state.status === 'error'`, поки старі дані вже були: форма
 * лишалася, а людина не бачила жодного натяку, що фонова перевірка не
 * пройшла.
 */
describe('displayDecision', () => {
  it('ready — дані є, не оновлюється, помилки нема', () => {
    const state: ResourceState<string> = { status: 'ready', data: 'A' }

    expect(displayDecision(state, undefined)).toEqual({
      data: 'A',
      refreshing: false,
      backgroundErrorMessage: undefined,
    })
  })

  /**
   * «Я натиснув Start — перевірити», поки ще НЕ підключено: reload()
   * стартував (`loading`), попередні дані (`connected: false`) мають
   * лишитися — форма й deep link не зникають, лише зʼявляється
   * ненавʼязливий індикатор.
   */
  it('loading з попередніми даними — дані лишаються, refreshing=true', () => {
    const state: ResourceState<string> = { status: 'loading' }

    expect(displayDecision(state, 'ще чинні')).toEqual({
      data: 'ще чинні',
      refreshing: true,
      backgroundErrorMessage: undefined,
    })
  })

  it('loading без попередніх даних (перший запит) — нічого показувати', () => {
    const state: ResourceState<string> = { status: 'loading' }

    expect(displayDecision(state, undefined)).toEqual({
      data: undefined,
      refreshing: false,
      backgroundErrorMessage: undefined,
    })
  })

  /**
   * Головний сценарій дефекту: фонова помилка (5xx/мережа) під час
   * «перевірити», коли форма й deepLink уже показані. Дані лишаються (форма
   * не розмонтовується), а `backgroundErrorMessage` несе повідомлення, яке
   * сторінка показує ненавʼязливим банером над формою.
   */
  it('error з попередніми даними — дані лишаються, помилка видима', () => {
    const state: ResourceState<string> = { status: 'error', message: 'мережа впала' }

    expect(displayDecision(state, 'ще чинні')).toEqual({
      data: 'ще чинні',
      refreshing: false,
      backgroundErrorMessage: 'мережа впала',
    })
  })

  it('error без попередніх даних (перший запит провалився) — банеру нема на чому лежати', () => {
    const state: ResourceState<string> = { status: 'error', message: 'мережа впала' }

    expect(displayDecision(state, undefined)).toEqual({
      data: undefined,
      refreshing: false,
      backgroundErrorMessage: undefined,
    })
  })

  /**
   * Наступний УСПІШНИЙ reload() сам собою прибирає помилку: `status`
   * повертається до `'ready'`, і жодна з двох умов (`refreshing`,
   * `backgroundErrorMessage`) більше не спрацьовує — без окремого
   * "скинути помилку" стану чи ефекту.
   */
  it('ready після error — помилка зникає сама, без окремого скидання', () => {
    const afterError = displayDecision({ status: 'error', message: 'X' }, 'дані')

    expect(afterError.backgroundErrorMessage).toBe('X')

    const afterRecovery = displayDecision({ status: 'ready', data: 'нові дані' }, 'дані')

    expect(afterRecovery).toEqual({
      data: 'нові дані',
      refreshing: false,
      backgroundErrorMessage: undefined,
    })
  })
})
