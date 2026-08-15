import { FRIENDSHIP_STATUS, type FriendshipStatus } from '@bookswap/shared'
import {
  actorRoleOf,
  isMember,
  normalizePair,
  otherIdOf,
  relationOf,
  stateOf,
  type FriendshipRecord,
} from './friendship.pair'

const LOW = 'aaa-marta'
const HIGH = 'zzz-oles'
const OUTSIDER = 'mmm-bohdan'

function record(overrides: Partial<FriendshipRecord> = {}): FriendshipRecord {
  return {
    userAId: LOW,
    userBId: HIGH,
    status: 'PENDING',
    requestedById: LOW,
    blockedById: null,
    ...overrides,
  }
}

describe('normalizePair — §4.3, інваріант §5.3.5', () => {
  it('дає той самий порядок незалежно від ініціатора', () => {
    // Це і є суть інваріанта: пара визначається сортуванням id, а не тим, хто
    // натиснув кнопку. Інакше на одну пару зʼявляється два рядки.
    expect(normalizePair(LOW, HIGH)).toEqual(normalizePair(HIGH, LOW))
  })

  it('менший id завжди стає userAId', () => {
    expect(normalizePair(HIGH, LOW)).toEqual({ userAId: LOW, userBId: HIGH })
    expect(normalizePair(LOW, HIGH)).toEqual({ userAId: LOW, userBId: HIGH })
  })

  it('порядок лексикографічний, а не за довжиною', () => {
    expect(normalizePair('b', 'aaaa')).toEqual({ userAId: 'aaaa', userBId: 'b' })
  })

  it.each([
    ['cuid-подібні', 'ckl1a', 'ckl1b'],
    ['цифри проти літер', '123', 'abc'],
    ['верхній регістр проти нижнього', 'Zed', 'alice'],
  ])('%s: обидва напрямки збігаються', (_name, one, other) => {
    expect(normalizePair(one, other)).toEqual(normalizePair(other, one))

    const pair = normalizePair(one, other)

    expect(pair.userAId < pair.userBId).toBe(true)
  })

  it('пара із самим собою неможлива', () => {
    expect(() => normalizePair(LOW, LOW)).toThrow(/самим собою/)
  })
})

describe('otherIdOf / isMember', () => {
  it('віддає другого учасника з обох боків', () => {
    expect(otherIdOf(record(), LOW)).toBe(HIGH)
    expect(otherIdOf(record(), HIGH)).toBe(LOW)
  })

  it('кидає на сторонньому — мовчазний undefined тут став би чужим доступом', () => {
    expect(() => otherIdOf(record(), OUTSIDER)).toThrow(/не належить/)
  })

  it('isMember розрізняє учасників і стороннього', () => {
    expect(isMember(record(), LOW)).toBe(true)
    expect(isMember(record(), HIGH)).toBe(true)
    expect(isMember(record(), OUTSIDER)).toBe(false)
  })
})

describe('stateOf', () => {
  it('відсутність рядка — це стан NONE, а не «нічого»', () => {
    expect(stateOf(null)).toBe('NONE')
  })

  it.each([...FRIENDSHIP_STATUS])('віддає статус рядка як є: %s', (status) => {
    expect(stateOf(record({ status }))).toBe(status)
  })
})

describe('actorRoleOf — роль рахується від requestedById / blockedById, не від A/B', () => {
  it('без рядка ролі немає', () => {
    expect(actorRoleOf(null, LOW)).toBe('NONE')
  })

  it.each(['PENDING', 'ACCEPTED', 'DECLINED'] as FriendshipStatus[])(
    '%s: ініціатор — REQUESTER, другий — RECIPIENT',
    (status) => {
      const friendship = record({ status, requestedById: HIGH })

      expect(actorRoleOf(friendship, HIGH)).toBe('REQUESTER')
      expect(actorRoleOf(friendship, LOW)).toBe('RECIPIENT')
    },
  )

  it('роль не залежить від того, хто в парі A: ініціатором може бути будь-хто', () => {
    expect(actorRoleOf(record({ requestedById: LOW }), LOW)).toBe('REQUESTER')
    expect(actorRoleOf(record({ requestedById: HIGH }), HIGH)).toBe('REQUESTER')
  })

  it('BLOCKED: автор блокування — BLOCKER, другий — BLOCKED', () => {
    const friendship = record({ status: 'BLOCKED', blockedById: HIGH, requestedById: LOW })

    expect(actorRoleOf(friendship, HIGH)).toBe('BLOCKER')
    // requestedById тут навмисно вказує на LOW: у стані BLOCKED роль визначає
    // саме blockedById, інакше ініціатор давнього запиту зняв би чужий блок.
    expect(actorRoleOf(friendship, LOW)).toBe('BLOCKED')
  })
})

describe('relationOf — стан пари з погляду того, хто питає', () => {
  it('без рядка — NONE', () => {
    expect(relationOf(null, LOW)).toBe('NONE')
  })

  it('PENDING читається по-різному з двох боків', () => {
    const friendship = record({ status: 'PENDING', requestedById: LOW })

    expect(relationOf(friendship, LOW)).toBe('REQUEST_SENT')
    expect(relationOf(friendship, HIGH)).toBe('REQUEST_RECEIVED')
  })

  it('ACCEPTED однаковий з обох боків', () => {
    const friendship = record({ status: 'ACCEPTED' })

    expect(relationOf(friendship, LOW)).toBe('FRIENDS')
    expect(relationOf(friendship, HIGH)).toBe('FRIENDS')
  })

  it('DECLINED виглядає як NONE — він не заважає надіслати новий запит', () => {
    const friendship = record({ status: 'DECLINED', requestedById: LOW })

    expect(relationOf(friendship, LOW)).toBe('NONE')
    expect(relationOf(friendship, HIGH)).toBe('NONE')
  })

  it('BLOCKED розрізняє того, хто заблокував, і того, кого заблокували', () => {
    const friendship = record({ status: 'BLOCKED', blockedById: LOW })

    expect(relationOf(friendship, LOW)).toBe('BLOCKED_BY_ME')
    expect(relationOf(friendship, HIGH)).toBe('BLOCKED_ME')
  })
})
