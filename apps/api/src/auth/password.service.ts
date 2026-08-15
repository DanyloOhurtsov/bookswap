import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'

/**
 * Ручна обгортка замість `promisify(scrypt)`: остання розв'язується у варіант
 * без `options`, і передати параметри KDF стає неможливо.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error !== null) reject(error)
      else resolve(derivedKey)
    })
  })
}

/**
 * Стеля пам'яті на один виклик KDF — 64 МіБ.
 *
 * Одночасно два запобіжники: передається в `maxmem` (дефолт Node — 32 МіБ, тобто
 * впритул до потрібних 32, і виклик падає) і обмежує згори параметри, прочитані
 * з бази. Другий важливіший: `128 · N · r` росте лінійно від N, і рядок із
 * `N = 2^24` перетворив би одну спробу входу на 16 ГБ алокації.
 */
const MAX_MEMORY_BYTES = 64 * 1024 * 1024

/**
 * Параметри scrypt для НОВИХ гешів. `cost` — головний важіль: пам'ять і час
 * ростуть лінійно від нього, тож 2^15 дає близько 100 мс і 32 МіБ на геш.
 */
const PARAMS = {
  cost: 2 ** 15,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
  saltLength: 16,
} as const

/**
 * Допустимі межі для параметрів, ПРОЧИТАНИХ ІЗ БАЗИ.
 *
 * Формат самоописний, і це його плата: числа в рядку керують алокацією пам'яті.
 * Поки геш пише лише `hash()`, вони завжди наші — але рядок приходить із БД, і
 * припускати, що БД недоторкана, означає лишити шлях від «хтось дописав рядок»
 * до «сервер ліг на першому логіні».
 *
 * Нижні межі не менш важливі за верхні: `N = 2` порахується миттєво, і
 * підмінений на такий геш пароль стане перебиральним за хвилини.
 */
const BOUNDS = {
  cost: { min: 2 ** 14, max: 2 ** 20 },
  blockSize: { min: 1, max: 32 },
  parallelization: { min: 1, max: 4 },
  keyLength: { min: 16, max: 128 },
  saltLength: { min: 8, max: 64 },
} as const

const ALGORITHM = 'scrypt'
const FIELD_SEPARATOR = '$'

/** Лише десяткові цифри: `Number` радо ковтає ' 32768 ', '0x8000' і '3.2768e4'. */
const DECIMAL = /^\d+$/

/**
 * Хешування паролів (§6.1).
 *
 * scrypt із `node:crypto`, а не bcrypt чи argon2, з двох причин. Перша — це
 * memory-hard KDF, тобто саме те, що потрібно проти перебору на GPU. Друга —
 * він уже в рантаймі: bcrypt і argon2 тягнуть нативні збірки, а прод за §13.1
 * це ARM, де кожен нативний модуль стає окремим ризиком на деплої.
 *
 * Формат зберігання самоописний: `scrypt$cost$blockSize$parallelization$salt$hash`.
 * Параметри лежать поруч із гешем, тож їх можна підняти, не ламаючи наявні паролі —
 * старі перевіряться своїми, нові запишуться новими.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name)

  async hash(password: string): Promise<string> {
    const salt = randomBytes(PARAMS.saltLength)
    const derived = await this.derive(password, salt, PARAMS)

    return [
      ALGORITHM,
      PARAMS.cost,
      PARAMS.blockSize,
      PARAMS.parallelization,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join(FIELD_SEPARATOR)
  }

  /**
   * Перевірка пароля.
   *
   * НІКОЛИ не кидає — ні на зіпсованому рядку, ні на відмові самого scrypt.
   * Виняток тут відрізняв би «акаунт із битим гешем у базі» від «невірний
   * пароль» і став би витоком через поведінку, а на рівні HTTP перетворив би
   * невдалий вхід на 500.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseStored(stored)

    if (parsed === undefined) {
      // У лог, не у відповідь: биті рядки в базі — привід розібратися, але той,
      // хто вводить пароль, про це знати не має.
      this.logger.warn('Збережений геш не пройшов розбір — вхід відхилено')
      return false
    }

    let derived: Buffer

    try {
      derived = await this.derive(password, parsed.salt, parsed)
    } catch (error) {
      // Сюди веде відмова самого KDF: параметри, які пройшли межі, але не
      // подобаються Node, або нестача пам'яті під навантаженням.
      this.logger.error('scrypt відмовив під час перевірки пароля', error)
      return false
    }

    // Довжини можуть не збігтися, якщо в базі геш від інших параметрів —
    // timingSafeEqual на таких буферах кидає, тому звіряємо заздалегідь.
    if (derived.length !== parsed.hash.length) return false

    return timingSafeEqual(derived, parsed.hash)
  }

  private derive(
    password: string,
    salt: Buffer,
    params: { cost: number; blockSize: number; parallelization: number; keyLength: number },
  ): Promise<Buffer> {
    // NFC: «é» одним кодпоінтом і «e + комбінований акут» виглядають однаково, але
    // дають різні байти. Без нормалізації пароль, набраний на macOS, не збігся б
    // із тим самим паролем із Windows.
    return scryptAsync(password.normalize('NFC'), salt, params.keyLength, {
      N: params.cost,
      r: params.blockSize,
      p: params.parallelization,
      maxmem: MAX_MEMORY_BYTES,
    })
  }
}

interface StoredHash {
  cost: number
  blockSize: number
  parallelization: number
  keyLength: number
  salt: Buffer
  hash: Buffer
}

/** Node вимагає N — степінь двійки, більший за 1. */
function isPowerOfTwo(value: number): boolean {
  return value > 1 && (value & (value - 1)) === 0
}

function parseDecimal(
  value: string,
  { min, max }: { min: number; max: number },
): number | undefined {
  if (!DECIMAL.test(value)) return undefined

  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed)) return undefined
  if (parsed < min || parsed > max) return undefined

  return parsed
}

/**
 * Розбирає збережений рядок і повертає параметри, які БЕЗПЕЧНО передати в scrypt.
 * Будь-яка невідповідність — `undefined`, без винятків і без часткових результатів.
 */
function parseStored(stored: string): StoredHash | undefined {
  const parts = stored.split(FIELD_SEPARATOR)

  if (parts.length !== 6) return undefined

  const [algorithm, rawCost, rawBlockSize, rawParallelization, rawSalt, rawHash] = parts

  if (algorithm !== ALGORITHM) return undefined
  if (
    rawCost === undefined ||
    rawBlockSize === undefined ||
    rawParallelization === undefined ||
    rawSalt === undefined ||
    rawHash === undefined
  ) {
    return undefined
  }

  const cost = parseDecimal(rawCost, BOUNDS.cost)
  const blockSize = parseDecimal(rawBlockSize, BOUNDS.blockSize)
  const parallelization = parseDecimal(rawParallelization, BOUNDS.parallelization)

  if (cost === undefined || blockSize === undefined || parallelization === undefined) {
    return undefined
  }

  if (!isPowerOfTwo(cost)) return undefined

  // Той самий розрахунок, який робить Node перед алокацією. Перевіряємо самі, щоб
  // відмова була передбачуваним `false`, а не винятком із надр крипто-модуля.
  if (128 * cost * blockSize > MAX_MEMORY_BYTES) return undefined

  const salt = Buffer.from(rawSalt, 'base64')
  const hash = Buffer.from(rawHash, 'base64')

  if (salt.length < BOUNDS.saltLength.min || salt.length > BOUNDS.saltLength.max) return undefined
  if (hash.length < BOUNDS.keyLength.min || hash.length > BOUNDS.keyLength.max) return undefined

  return { cost, blockSize, parallelization, keyLength: hash.length, salt, hash }
}
