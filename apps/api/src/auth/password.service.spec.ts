import { PasswordService } from './password.service'

describe('PasswordService', () => {
  const passwords = new PasswordService()
  const password = 'pravylnyj-parol-2026'

  it('приймає правильний пароль', async () => {
    const stored = await passwords.hash(password)

    expect(await passwords.verify(password, stored)).toBe(true)
  })

  it('відхиляє неправильний', async () => {
    const stored = await passwords.hash(password)

    expect(await passwords.verify('nepravylnyj-parol', stored)).toBe(false)
    expect(await passwords.verify(`${password} `, stored)).toBe(false)
    expect(await passwords.verify('', stored)).toBe(false)
  })

  it('не зберігає пароль у відкритому вигляді', async () => {
    const stored = await passwords.hash(password)

    expect(stored).not.toContain(password)
  })

  it('дає різні гефі для однакових паролів — сіль випадкова', async () => {
    const [first, second] = await Promise.all([passwords.hash(password), passwords.hash(password)])

    expect(first).not.toBe(second)
    expect(await passwords.verify(password, first)).toBe(true)
    expect(await passwords.verify(password, second)).toBe(true)
  })

  it('записує параметри поруч із гешем — їх можна підняти без ламання старих паролів', async () => {
    const stored = await passwords.hash(password)
    const [algorithm, cost, blockSize, parallelization, salt, hash] = stored.split('$')

    expect(algorithm).toBe('scrypt')
    expect(Number(cost)).toBeGreaterThanOrEqual(2 ** 15)
    expect(Number(blockSize)).toBe(8)
    expect(Number(parallelization)).toBe(1)
    expect(Buffer.from(salt ?? '', 'base64')).toHaveLength(16)
    expect(Buffer.from(hash ?? '', 'base64')).toHaveLength(64)
  })

  it('перевіряє пароль, збережений зі слабшими параметрами', async () => {
    // Імітує запис, зроблений до підняття cost: перевірка мусить іти параметрами
    // з рядка, інакше після зміни константи всі паролі стануть «невірними».
    const legacy = await new PasswordService().hash(password)
    const [, , , , salt] = legacy.split('$')

    expect(salt).toBeDefined()
    expect(await passwords.verify(password, legacy)).toBe(true)
  })

  it.each([
    ['порожній рядок', ''],
    ['не той алгоритм', 'bcrypt$32768$8$1$c2FsdA==$aGFzaA=='],
    ['бракує полів', 'scrypt$32768$8$1$c2FsdA=='],
    ['нечислові параметри', 'scrypt$a$b$c$c2FsdA==$aGFzaA=='],
    ['порожній геш', 'scrypt$32768$8$1$c2FsdA==$'],
  ])('повертає false, а не кидає, на зіпсованому геші: %s', async (_name, stored) => {
    await expect(passwords.verify(password, stored)).resolves.toBe(false)
  })

  it('нормалізує Unicode — той самий пароль із різних розкладок збігається', async () => {
    const composed = 'passé-parol-2026'.normalize('NFC')
    const decomposed = 'passé-parol-2026'.normalize('NFD')

    expect(composed).not.toBe(decomposed)
    expect(await passwords.verify(decomposed, await passwords.hash(composed))).toBe(true)
  })
})

/**
 * Параметри KDF приходять із бази й керують алокацією пам'яті. Поки геші пише
 * лише `hash()`, вони завжди наші — але припускати, що в базі не може опинитися
 * чужий рядок, означає лишити шлях від «хтось дописав рядок» до «сервер ліг на
 * першому логіні» або «пароль перебирається за хвилини».
 */
describe('PasswordService.verify: межі параметрів зі збереженого рядка', () => {
  const passwords = new PasswordService()
  const password = 'pravylnyj-parol-2026'

  /** Рядок правильної форми з підміненими параметрами. */
  function stored({
    algorithm = 'scrypt',
    cost = '32768',
    blockSize = '8',
    parallelization = '1',
    saltBytes = 16,
    hashBytes = 64,
  }: {
    algorithm?: string
    cost?: string
    blockSize?: string
    parallelization?: string
    saltBytes?: number
    hashBytes?: number
  }): string {
    const salt = Buffer.alloc(saltBytes, 7).toString('base64')
    const hash = Buffer.alloc(hashBytes, 9).toString('base64')

    return [algorithm, cost, blockSize, parallelization, salt, hash].join('$')
  }

  it('еталонний рядок доходить до звірення — інакше решта тестів нічого не доводить', async () => {
    // Пароль не той, тож очікуємо false, але через РОЗБІР і scrypt, а не через
    // відмову на парсингу: це контроль самого хелпера.
    await expect(passwords.verify(password, stored({}))).resolves.toBe(false)
    await expect(passwords.verify(password, await passwords.hash(password))).resolves.toBe(true)
  })

  it.each([
    ['N не степінь двійки', { cost: '33000' }],
    ['N нижче межі — геш перебирався б за хвилини', { cost: '1024' }],
    ['N вище межі — 16 ГБ на одну спробу входу', { cost: String(2 ** 24) }],
    ['N = 0', { cost: '0' }],
    ['N = 1 (степенем двійки не вважається)', { cost: '1' }],
    ['r = 0', { blockSize: '0' }],
    ['r вище межі', { blockSize: '64' }],
    ['p = 0', { parallelization: '0' }],
    ['p вище межі', { parallelization: '8' }],
    ['сіль закоротка', { saltBytes: 4 }],
    ['сіль задовга', { saltBytes: 128 }],
    ['геш закороткий', { hashBytes: 8 }],
    ['геш задовгий', { hashBytes: 256 }],
  ])('відхиляє %s', async (_name, overrides) => {
    await expect(passwords.verify(password, stored(overrides))).resolves.toBe(false)
  })

  it('відхиляє добуток N·r понад стелю памʼяті, навіть коли кожен параметр окремо в межах', async () => {
    // N = 2^17 і r = 32 обидва допустимі, разом — 512 МіБ.
    await expect(
      passwords.verify(password, stored({ cost: String(2 ** 17), blockSize: '32' })),
    ).resolves.toBe(false)
  })

  it.each([
    ['шістнадцяткове N', { cost: '0x8000' }],
    ['експоненційний запис', { cost: '3.2768e4' }],
    ['N із пробілами', { cost: ' 32768 ' }],
    ['від’ємне N', { cost: '-32768' }],
    ['дробове r', { blockSize: '8.5' }],
    ['плюс перед числом', { parallelization: '+1' }],
  ])('відхиляє неканонічний запис числа: %s', async (_name, overrides) => {
    // `Number` радо ковтає всі ці форми, і '0x8000' навіть дає легальні 32768 —
    // тому розбір іде через сувору перевірку на десяткові цифри.
    await expect(passwords.verify(password, stored(overrides))).resolves.toBe(false)
  })

  it.each([
    ['зайвий роздільник', 'scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaA==$extra'],
    ['інший алгоритм при правильній формі', 'argon2id$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaA=='],
    ['лише роздільники', '$$$$$'],
    ['порожня сіль', 'scrypt$32768$8$1$$aGFzaA=='],
  ])('відхиляє зіпсовану форму рядка: %s', async (_name, value) => {
    await expect(passwords.verify(password, value)).resolves.toBe(false)
  })

  it('жоден зіпсований рядок не кидає — вхід відхиляється, а не падає з 500', async () => {
    const broken = [
      '',
      '$',
      'scrypt',
      'scrypt$'.repeat(10),
      stored({ cost: String(2 ** 30) }),
      stored({ blockSize: String(Number.MAX_SAFE_INTEGER) }),
      stored({ cost: '99999999999999999999999' }),
    ]

    for (const value of broken) {
      await expect(passwords.verify(password, value)).resolves.toBe(false)
    }
  })
})
