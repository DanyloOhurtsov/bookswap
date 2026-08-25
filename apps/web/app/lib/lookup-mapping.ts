import type { BookLookupResult } from '@bookswap/shared'

/**
 * §6.3, ланцюг `Work → Translation → Edition → Copy`: `BookLookupResult`
 * описує одне конкретне ISBN-видання, не абстрактний твір. Ця функція — єдине
 * місце, де lookup-результат розкладається по чернетках кроків майстра
 * (`catalog/new/page.tsx`), тому яке поле йде в яку сутність фіксується раз, а
 * не повторюється в кожному кроці окремо.
 *
 * Правила mapping (виправлення cleanup Stage 7):
 * - `title`, `authors` → лише `Work` — назва й автори твору не залежать від
 *   конкретного видання;
 * - `publishedYear` → лише `Edition.year`. **Ніколи** `Work.firstPubYear`:
 *   рік видання — не рік першої публікації твору (перевидання новіші за
 *   оригінал), а провайдер не повідомляє окремого work-level поля, тож
 *   `Work.firstPubYear` із lookup не автозаповнюється взагалі — лишається
 *   порожнім, редагованим руками;
 * - `publisher`, `coverUrl` → лише `Edition`;
 * - `language` → лише `Translation.lang` (мова, на яку перекладено). У
 *   домені немає окремого поля `Edition.lang` (воно обчислюється з
 *   `Translation.lang` або `Work.origLang`), а `Work.origLang` і
 *   `Translation.sourceLang` provider не повідомляє — підставляти туди
 *   значення означало б вгадувати мову оригіналу.
 *
 * Функція чиста й не викликається з ефекту. Компонент може обчислювати draft
 * повторно, але React використовує його лише як початкові значення `useState`,
 * тож подальше редагування користувачем не перезаписується повторним рендером.
 */

export interface WorkDraftFromLookup {
  title: string
  authors: string[]
}

export interface EditionDraftFromLookup {
  publisher: string
  /** Порожній рядок, не `undefined`: керований `<input type="number">` не приймає undefined. */
  year: string
  coverUrl: string
}

export interface LookupWizardDraft {
  work: WorkDraftFromLookup
  edition: EditionDraftFromLookup
  /** `undefined`, якщо lookup не дав мови або її не вдалось нормалізувати. */
  translationLang: string | undefined
}

export function mapLookupResultToDraft(lookup: BookLookupResult | undefined): LookupWizardDraft {
  return {
    work: {
      title: lookup?.title ?? '',
      authors: lookup?.authors ?? [],
    },
    edition: {
      publisher: lookup?.publisher ?? '',
      year: lookup?.publishedYear === undefined ? '' : String(lookup.publishedYear),
      coverUrl: lookup?.coverUrl ?? '',
    },
    translationLang: lookup?.language,
  }
}
