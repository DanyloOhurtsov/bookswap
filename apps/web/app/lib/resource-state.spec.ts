import { requestKey, schemaIdOf, visibleState, type ResourceSnapshot } from './resource-state'

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
