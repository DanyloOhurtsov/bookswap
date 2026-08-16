import type { PrismaService } from '../prisma/prisma.service'

/**
 * Нормалізація пошукового тексту. Без Nest — саме тому цей файл окремий: його
 * імпортує ще й `prisma/seed.ts`, який виконується `tsx` поза застосунком.
 *
 * Приймає і `PrismaService`, і `tx` із транзакції — той самий структурний прийом,
 * що вже застосований у `AccessService` і `NotificationsService`.
 */
export type RawQueryRunner = Pick<PrismaService, '$queryRaw'>

/**
 * §4.4: «lower + unaccent».
 *
 * Правило живе в БД функцією `bookswap_norm`, а не тут у TypeScript, і це не
 * дрібниця. `Work.titleNorm` мусить збігатися з нормалізованим пошуковим
 * запитом **символ у символ**, інакше fuzzy мовчки не знаходить нічого. Дві
 * реалізації неминуче розійдуться: `lower(unaccent('Їжак'))` у Postgres дає
 * «їжак», а зняття діакритики через NFD у JS — «іжак», бо `ї` розкладається на
 * `і` + діерезис. Тому визначення одне, і воно там, де виконується пошук.
 *
 * Ціна — один round trip на запис у каталог. Створення твору відбувається рідко
 * й обмежене rate limiting'ом (§11); розсинхрон нормалізації ціни не має.
 *
 * Порядок результату відповідає вхідному: `WITH ORDINALITY` нумерує елементи
 * масиву, і саме за цим номером іде `ORDER BY`. Без нього порядок рядків не
 * гарантований, і імена авторів дісталися б не тим авторам.
 */
export async function normalizeSearchText(
  client: RawQueryRunner,
  values: string[],
): Promise<string[]> {
  if (values.length === 0) return []

  const rows = await client.$queryRaw<{ value: string }[]>`
    SELECT bookswap_norm(source) AS value
    FROM unnest(${values}::text[]) WITH ORDINALITY AS t(source, position)
    ORDER BY t.position
  `

  return rows.map((row) => row.value)
}

/**
 * Символи, значущі для `LIKE`, екрануються — інакше запит «100%» став би
 * шаблоном «усе підряд», а «_» матчив би будь-яку літеру.
 *
 * Робиться в TypeScript, а не в SQL, свідомо: `bookswap_norm` ніколи не породжує
 * `%`, `_` чи `\`, тож екранувати вже нормалізований рядок безпечно, а вкладені
 * `replace()` у SQL із подвійним екрануванням бекслеша — рівно той код, який
 * ніхто потім не перечитає правильно.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
