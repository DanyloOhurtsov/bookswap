import { registerDecorator, type ValidationOptions } from 'class-validator'
import { isLanguageCode, isValidIsbn13 } from '@bookswap/shared'

/**
 * Декоратори `class-validator`, побудовані **поверх** предикатів зі `shared`.
 *
 * §11 вимагає обидва механізми валідації — zod для контракту й class-validator
 * для DTO, — але саме правило дублювати не можна. Контрольну суму ISBN чи
 * перелік кодів ISO 639-1, переписані вдруге, розійшлися б із першою ж правкою,
 * і жоден тест парності цього б не побачив: він порівнює вироки, а не джерела.
 * Тому декоратори тонкі — вони лише підключають той самий предикат.
 */

/** Значення, які `@IsOptional()` пропускає: «не передали» і «прибрати». */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

export function IsLanguageCode(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isLanguageCode',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Невідомий код мови — потрібен ISO 639-1, напр. «uk» або «en»',
        ...options,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isLanguageCode(value),
      },
    })
  }
}

export function IsIsbn13(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isIsbn13',
      target: object.constructor,
      propertyName,
      options: { message: 'Некоректний ISBN-13: не сходиться контрольна сума', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidIsbn13(value),
      },
    })
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Календарна дата без часу — те саме, що `z.iso.date()`.
 *
 * Перевіряється не лише формат, а й існування дати: `new Date('2026-02-31')` мовчки
 * стає 3 березня, тож єдиний надійний спосіб — звірити зворотне перетворення.
 * Без цього «31 лютого» доїхало б до БД як інший день.
 */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false

  const parsed = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

export function IsIsoDate(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isIsoDate',
      target: object.constructor,
      propertyName,
      options: { message: 'Потрібна дата у форматі РРРР-ММ-ДД', ...options },
      validator: { validate: isIsoDate },
    })
  }
}

/**
 * Клітинка матриці §7.6 названа рівно один раз.
 *
 * Теж висить на масиві, а не на елементі: правило про **набір**, а не про окремий
 * рядок. Дублікат — це 400, а не «перемагає останній»: два різні значення однієї
 * клітинки в одному тілі означають, що клієнт зібрав форму неправильно, і
 * зберегти будь-яке з них — зберегти не те, що людина бачила на екрані.
 */
export function EachPreferenceCellOnce(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'eachPreferenceCellOnce',
      target: object.constructor,
      propertyName,
      options: { message: 'Одна клітинка матриці згадана двічі', ...options },
      validator: {
        validate: (value: unknown) => {
          if (!Array.isArray(value)) return false

          const cells = value.map((item) => {
            if (typeof item !== 'object' || item === null) return ''

            const { type, channel } = item as { type?: unknown; channel?: unknown }

            return `${String(type)}:${String(channel)}`
          })

          return new Set(cells).size === cells.length
        },
      },
    })
  }
}

/**
 * Правило про **пару** полів усередині елемента масиву: автор задається або
 * `authorId`, або `name`, і ніколи обома.
 *
 * Висить на самому масиві, а не на його елементах, і це вимушено: `@IsOptional()`
 * на властивості глушить усі інші валідатори тієї ж властивості, тож на
 * `authorId` чи `name` така перевірка просто не спрацювала б.
 */
export function EachAuthorHasOneSource(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'eachAuthorHasOneSource',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Потрібен або authorId наявного автора, або name нового — рівно одне з двох',
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.every((item) => {
            if (typeof item !== 'object' || item === null) return false

            const { authorId, name } = item as { authorId?: unknown; name?: unknown }

            return isAbsent(authorId) !== isAbsent(name)
          }),
      },
    })
  }
}
