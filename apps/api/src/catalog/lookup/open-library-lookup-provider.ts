import { Injectable } from '@nestjs/common'
import { isLanguageCode, type BookLookupResult } from '@bookswap/shared'
import { BookLookupProviderError, type BookLookupProvider } from './book-lookup-provider'

const API_ROOT = 'https://openlibrary.org/api/books'

interface OpenLibraryAuthor {
  name?: string
}

interface OpenLibraryPublisher {
  name?: string
}

interface OpenLibraryCover {
  small?: string
  medium?: string
  large?: string
}

interface OpenLibraryLanguage {
  key?: string
}

interface OpenLibraryBookRecord {
  key?: string
  title?: string
  authors?: OpenLibraryAuthor[]
  publish_date?: string
  publishers?: OpenLibraryPublisher[]
  cover?: OpenLibraryCover
  languages?: OpenLibraryLanguage[]
}

/**
 * Open Library кодує мову виданнями MARC (= ISO 639-2, здебільшого форма /B):
 * `/languages/eng`, `/languages/ukr`. Домен репозиторію (§4.4, `languageCodeSchema`)
 * прийняв ISO 639-1 — двобуквені коди, — тому мапа нижче переводить трибуквені
 * MARC-коди на дволітерні. Обидві форми (bibliographic/terminologic), де вони
 * розходяться, ведуть до того самого ISO 639-1, напр. `ger`/`deu` → `de`.
 *
 * Список — таблиця ISO 639-2 ↔ ISO 639-1, а не здогад: мова, якої тут немає
 * (напр. `mul` — «кілька мов», `und` — «не визначено»), лишається
 * ненормалізованою — див. §6.3 п.7: «невідоме значення залишай порожнім, а не
 * підміняй випадковим default».
 */
const ISO_639_2_TO_1: Readonly<Record<string, string>> = {
  aar: 'aa',
  abk: 'ab',
  ave: 'ae',
  afr: 'af',
  aka: 'ak',
  amh: 'am',
  arg: 'an',
  ara: 'ar',
  asm: 'as',
  ava: 'av',
  aym: 'ay',
  aze: 'az',
  bak: 'ba',
  bel: 'be',
  bul: 'bg',
  bih: 'bh',
  bis: 'bi',
  bam: 'bm',
  ben: 'bn',
  tib: 'bo',
  bod: 'bo',
  bre: 'br',
  bos: 'bs',
  cat: 'ca',
  che: 'ce',
  cha: 'ch',
  cos: 'co',
  cre: 'cr',
  cze: 'cs',
  ces: 'cs',
  chu: 'cu',
  chv: 'cv',
  wel: 'cy',
  cym: 'cy',
  dan: 'da',
  ger: 'de',
  deu: 'de',
  div: 'dv',
  dzo: 'dz',
  ewe: 'ee',
  gre: 'el',
  ell: 'el',
  eng: 'en',
  epo: 'eo',
  spa: 'es',
  est: 'et',
  baq: 'eu',
  eus: 'eu',
  per: 'fa',
  fas: 'fa',
  ful: 'ff',
  fin: 'fi',
  fij: 'fj',
  fao: 'fo',
  fre: 'fr',
  fra: 'fr',
  fry: 'fy',
  gle: 'ga',
  gla: 'gd',
  glg: 'gl',
  grn: 'gn',
  guj: 'gu',
  glv: 'gv',
  hau: 'ha',
  heb: 'he',
  hin: 'hi',
  hmo: 'ho',
  hrv: 'hr',
  hat: 'ht',
  hun: 'hu',
  arm: 'hy',
  hye: 'hy',
  her: 'hz',
  ina: 'ia',
  ind: 'id',
  ile: 'ie',
  ibo: 'ig',
  iii: 'ii',
  ipk: 'ik',
  ido: 'io',
  ice: 'is',
  isl: 'is',
  ita: 'it',
  iku: 'iu',
  jpn: 'ja',
  jav: 'jv',
  geo: 'ka',
  kat: 'ka',
  kon: 'kg',
  kik: 'ki',
  kua: 'kj',
  kaz: 'kk',
  kal: 'kl',
  khm: 'km',
  kan: 'kn',
  kor: 'ko',
  kau: 'kr',
  kas: 'ks',
  kur: 'ku',
  kom: 'kv',
  cor: 'kw',
  kir: 'ky',
  lat: 'la',
  ltz: 'lb',
  lug: 'lg',
  lim: 'li',
  lin: 'ln',
  lao: 'lo',
  lit: 'lt',
  lub: 'lu',
  lav: 'lv',
  mlg: 'mg',
  mah: 'mh',
  mao: 'mi',
  mri: 'mi',
  mac: 'mk',
  mkd: 'mk',
  mal: 'ml',
  mon: 'mn',
  mar: 'mr',
  may: 'ms',
  msa: 'ms',
  mlt: 'mt',
  bur: 'my',
  mya: 'my',
  nau: 'na',
  nob: 'nb',
  nde: 'nd',
  nep: 'ne',
  ndo: 'ng',
  dut: 'nl',
  nld: 'nl',
  nno: 'nn',
  nor: 'no',
  nbl: 'nr',
  nav: 'nv',
  nya: 'ny',
  oci: 'oc',
  oji: 'oj',
  orm: 'om',
  ori: 'or',
  oss: 'os',
  pan: 'pa',
  pli: 'pi',
  pol: 'pl',
  pus: 'ps',
  por: 'pt',
  que: 'qu',
  roh: 'rm',
  run: 'rn',
  rum: 'ro',
  ron: 'ro',
  rus: 'ru',
  kin: 'rw',
  san: 'sa',
  srd: 'sc',
  snd: 'sd',
  sme: 'se',
  sag: 'sg',
  sin: 'si',
  slo: 'sk',
  slk: 'sk',
  slv: 'sl',
  smo: 'sm',
  sna: 'sn',
  som: 'so',
  alb: 'sq',
  sqi: 'sq',
  srp: 'sr',
  ssw: 'ss',
  sot: 'st',
  sun: 'su',
  swe: 'sv',
  swa: 'sw',
  tam: 'ta',
  tel: 'te',
  tgk: 'tg',
  tha: 'th',
  tir: 'ti',
  tuk: 'tk',
  tgl: 'tl',
  tsn: 'tn',
  ton: 'to',
  tur: 'tr',
  tso: 'ts',
  tat: 'tt',
  twi: 'tw',
  tah: 'ty',
  uig: 'ug',
  ukr: 'uk',
  urd: 'ur',
  uzb: 'uz',
  ven: 've',
  vie: 'vi',
  vol: 'vo',
  wln: 'wa',
  wol: 'wo',
  xho: 'xh',
  yid: 'yi',
  yor: 'yo',
  zha: 'za',
  chi: 'zh',
  zho: 'zh',
  zul: 'zu',
}

/**
 * `/languages/eng` → `eng` → `en`. Невідомий, відсутній чи неочікуваного типу
 * (Open Library — зовнішній сервіс, тіло не типізоване рантаймом) код →
 * `undefined`, а не кинутий виняток: одне зіпсоване поле не має валити весь
 * lookup, коли решта відповіді придатна.
 */
export function normalizeOpenLibraryLanguage(languages: unknown): string | undefined {
  if (!Array.isArray(languages)) return undefined

  const first = languages[0] as OpenLibraryLanguage | undefined
  const key = first?.key
  if (typeof key !== 'string') return undefined

  const marc = key.split('/').pop()?.trim().toLowerCase()
  if (marc === undefined || marc === '') return undefined

  const code = ISO_639_2_TO_1[marc]

  return code !== undefined && isLanguageCode(code) ? code : undefined
}

/** Open Library повертає всі bibkeys одним об'єктом, ключ — `ISBN:<isbn>`. */
type OpenLibraryBooksResponse = Record<string, OpenLibraryBookRecord | undefined>

/** Перший рік у рядку виду «March 2003», «2003», «Jul 08, 2003». */
function extractYear(publishDate: unknown): number | undefined {
  if (typeof publishDate !== 'string') return undefined

  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(publishDate)

  return match === null ? undefined : Number(match[0])
}

/** `/books/OL123456M` → `OL123456M`. */
function externalIdFromKey(key: unknown): string | undefined {
  if (typeof key !== 'string') return undefined

  return key.split('/').pop()
}

/** Перше ім'я в масиві, що справді є непорожнім рядком — байдуже, що там ще намішано. */
function firstName(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return undefined

  const name = (entries[0] as { name?: unknown } | undefined)?.name

  return typeof name === 'string' && name.trim() !== '' ? name : undefined
}

/** Перша обкладинка, що справді є рядком-URL, у порядку «більша краще». */
function coverUrlFrom(cover: unknown): string | undefined {
  if (typeof cover !== 'object' || cover === null) return undefined

  const { large, medium, small } = cover as Record<string, unknown>

  for (const candidate of [large, medium, small]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }

  return undefined
}

/**
 * R1: Open Library — без ключа й без квоти.
 *
 * Books API (`jscmd=data`), а не `/isbn/{isbn}.json`: останній віддає авторів
 * лише посиланнями (`/authors/OL...A`) і вимагав би окремого запиту на кожного
 * — N+1 замість одного виклику. Books API одразу вкладає імена авторів,
 * видавця й обкладинку в саму відповідь.
 *
 * Невідомий ISBN — це НЕ HTTP 404: провайдер відповідає 200 з порожнім
 * об'єктом, якщо для запитаного bibkey немає запису. Це і є єдина ознака
 * «не знайдено» для цього API.
 */
@Injectable()
export class OpenLibraryLookupProvider implements BookLookupProvider {
  async lookup(isbn: string, signal: AbortSignal): Promise<BookLookupResult | undefined> {
    const bibkey = `ISBN:${isbn}`
    const url = `${API_ROOT}?bibkeys=${bibkey}&format=json&jscmd=data`

    let response: Response

    try {
      response = await fetch(url, { signal })
    } catch (error) {
      throw new BookLookupProviderError(error instanceof Error ? error.message : 'мережева помилка')
    }

    if (!response.ok) {
      throw new BookLookupProviderError(`Open Library відповів HTTP ${String(response.status)}`)
    }

    const body = await response.json().catch(() => undefined)

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BookLookupProviderError('Open Library повернув тіло, що не є JSON-об’єктом')
    }

    const record = (body as OpenLibraryBooksResponse)[bibkey] as Record<string, unknown> | undefined

    if (record === undefined) return undefined

    const title = record.title
    if (typeof title !== 'string' || title.trim() === '') {
      throw new BookLookupProviderError('Open Library повернув запис без назви')
    }

    const authors = Array.isArray(record.authors)
      ? record.authors
          .map((author: unknown) => (author as { name?: unknown } | null)?.name)
          .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
      : []

    const publisher = firstName(record.publishers)
    const coverUrl = coverUrlFrom(record.cover)
    const publishedYear = extractYear(record.publish_date)
    const externalId = externalIdFromKey(record.key)
    const language = normalizeOpenLibraryLanguage(record.languages)

    return {
      title,
      ...(authors.length > 0 ? { authors } : {}),
      ...(publishedYear === undefined ? {} : { publishedYear }),
      ...(language === undefined ? {} : { language }),
      ...(publisher === undefined ? {} : { publisher }),
      ...(coverUrl === undefined ? {} : { coverUrl }),
      ...(externalId === undefined ? {} : { externalId }),
    }
  }
}
