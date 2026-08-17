/**
 * Розпізнавання помилок Prisma за кодом.
 *
 * Живе окремо, бо на це спираються три незалежні речі: реєстрація (зайнятий email),
 * створення дружби (гонка двох `INSERT` на ту саму пару) і апрув лоану (гонка на
 * `one_active_loan_per_copy`). Усі мусять читати той самий код; копії розійшлися б
 * при першій же зміні версії Prisma.
 *
 * Перевірка структурна, а не `instanceof`: типи помилок живуть у згенерованому
 * клієнті, і залежність від його внутрішньої структури дорожча за перевірку поля.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

/** Безпечне читання вкладеного поля без `any` і без припущень про форму. */
function property(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined

  return (source as Record<string, unknown>)[key]
}

/**
 * Повідомлення, яке PostgreSQL віддав драйверу.
 *
 * Prisma 7 працює через драйвер-адаптер (`@prisma/adapter-pg`) і кладе оригінальну
 * помилку сюди: `meta.driverAdapterError.cause.originalMessage`. Саме там — і
 * тільки там — є назва **часткового** індексу: у `meta.target` Prisma пише поля
 * ('copyId'), а не ім'я обмеження, бо про сам індекс вона не знає (він дописаний
 * у міграцію руками, поза схемою).
 */
function driverMessage(error: unknown): string | undefined {
  const cause = property(property(property(error, 'meta'), 'driverAdapterError'), 'cause')
  const message = property(cause, 'originalMessage')

  return typeof message === 'string' ? message : undefined
}

/** Назви обмежень, які Prisma віддає безпосередньо, коли знає про них зі схеми. */
function declaredNames(error: unknown): string[] {
  const meta = property(error, 'meta')
  const names: string[] = []

  for (const value of [property(meta, 'target'), property(meta, 'constraint')]) {
    if (typeof value === 'string') names.push(value)
    else if (Array.isArray(value)) names.push(...value.filter((item) => typeof item === 'string'))
  }

  return names
}

/**
 * Порушення **конкретного** унікального обмеження.
 *
 * Навіщо окремо від `isUniqueViolation`: перетворювати будь-який `P2002` на
 * доменний код позичання не можна. Якщо колись зламається зовсім інше обмеження,
 * клієнт отримав би «на примірнику вже є активний лоан» — повідомлення, яке
 * впевнено бреше про причину й веде людину не туди.
 *
 * Ім'я в повідомленні драйвера шукається **в лапках**: без них `includes` дав би
 * хибне спрацювання на обмеженні, назва якого є префіксом іншого.
 *
 * Точна форма `meta` версійно залежна, тож вона не припускається, а **пінується
 * тестом на живій базі** — `test/db/loan-constraints.db-spec.ts` викликає реальне
 * порушення й перевіряє, що ця функція його впізнає, а порушення `User_email_key`
 * — ні. Якщо Prisma колись перенесе назву в інше поле, зламається той тест, а не
 * мовчазне перетворення чужої помилки на доменний код.
 */
export function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  if (!isUniqueViolation(error)) return false

  if (declaredNames(error).includes(constraint)) return true

  return driverMessage(error)?.includes(`"${constraint}"`) ?? false
}
