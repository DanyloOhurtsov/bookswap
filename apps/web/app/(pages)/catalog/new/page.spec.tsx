/** @jest-environment jsdom */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { Edition, Translation, Work, WorkAuthor, WorkDetailResponse } from '@bookswap/shared'
import NewBookPage from './page'

/**
 * Компонентні тести на чотири гілки флоу (Етап 7d, DoD):
 *
 * 1. крок 1 — пошук, показ кандидатів;
 * 2. гілка «наявне Edition» — лише `Copy`;
 * 3. гілка «наявне Work» — нове `Edition` (+ `Translation` за потреби);
 * 4. гілка «немає збігів» — повний ланцюг, з чернеткою з lookup, яка
 *    залишається редагованою, і зрозумілими повідомленнями на 429/504/помилку
 *    провайдера.
 *
 * `apiRequest` мокається цілим модулем (`ApiRequestError`/`describeError` —
 * реальні), бо саме через нього йдуть усі виклики бекенду з усіх кроків
 * майстра. Сесія й роутер мокаються окремо: це не предмет цього тесту.
 */

jest.mock('@/app/lib/api', () => {
  const actual = jest.requireActual<typeof import('@/app/lib/api')>('@/app/lib/api')

  return { ...actual, apiRequest: jest.fn() }
})

jest.mock('@/app/lib/use-session', () => ({
  useSession: () => ({
    state: { status: 'authenticated', user: { id: 'me', name: 'Тест', email: 't@example.com' } },
    reload: jest.fn(),
    setUser: jest.fn(),
  }),
}))

let searchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => searchParams,
}))

const { apiRequest: mockApiRequest } = jest.requireMock<{ apiRequest: jest.Mock }>('@/app/lib/api')

/** Валідний ISBN-13 (перевірено `isValidIsbn13`): 978-3-16-148410 + контрольна цифра 0. */
const CANDIDATE_ISBN = '9783161484100'

function work(overrides: Partial<Work> = {}): Work {
  return {
    id: 'work-1',
    title: 'Кобзар',
    origLang: 'uk',
    firstPubYear: 1840,
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function author(overrides: Partial<WorkAuthor> = {}): WorkAuthor {
  return { id: 'author-1', name: 'Тарас Шевченко', nameLatin: null, role: 'AUTHOR', ...overrides }
}

function edition(overrides: Partial<Edition> = {}): Edition {
  return {
    id: 'edition-1',
    workId: 'work-1',
    translationId: null,
    publisher: 'Наука',
    year: 2019,
    isbn13: null,
    pageCount: 320,
    coverUrl: null,
    format: 'HARDCOVER',
    lang: 'uk',
    translator: null,
    ...overrides,
  }
}

function translation(overrides: Partial<Translation> = {}): Translation {
  return {
    id: 'translation-1',
    workId: 'work-1',
    translator: 'Тестовий Перекладач',
    lang: 'de',
    sourceLang: 'en',
    year: null,
    isAbridged: false,
    hasNotes: false,
    notes: null,
    editionCount: 0,
    ...overrides,
  }
}

function candidate(overrides: Partial<WorkDetailResponse> = {}): WorkDetailResponse {
  return { work: work(), authors: [author()], translations: [], editions: [], ...overrides }
}

/**
 * Не HTTP-клієнт, а маршрутизатор фейкових відповідей за шляхом запиту.
 *
 * Найдовший збіг префікса, а не перший-у-порядку-оголошення: інакше `/works`
 * (створення `Work`) перехопив би виклик `/works/:id/editions` (створення
 * `Edition`), бо другий шлях теж починається з першого.
 */
function routeApiRequest(handlers: Record<string, (options: { body?: unknown }) => unknown>): void {
  const byLength = Object.entries(handlers).sort(([a], [b]) => b.length - a.length)

  mockApiRequest.mockImplementation(async (path: string, options: { body?: unknown } = {}) => {
    const match = byLength.find(([prefix]) => path.startsWith(prefix))

    if (match === undefined) throw new Error(`Немає фейкової відповіді для ${path}`)

    return match[1](options)
  })
}

beforeEach(() => {
  searchParams = new URLSearchParams()
  mockApiRequest.mockReset()
})

async function search(query: string): Promise<void> {
  const user = userEvent.setup()

  render(<NewBookPage />)

  const input = await screen.findByLabelText('Назва або ISBN')
  await user.type(input, query)
  await user.click(screen.getByRole('button', { name: 'Шукати' }))
}

describe('крок 1 — пошук кандидатів', () => {
  it('показує знайдені твори з їхніми виданнями', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [candidate()] }),
    })

    await search('Кобзар')

    expect(await screen.findByText('Кобзар')).toBeInTheDocument()
    expect(screen.getByText('Тарас Шевченко')).toBeInTheDocument()
  })
})

describe('гілка «наявне Edition»', () => {
  it('створює лише Copy, минаючи Work/Translation/Edition', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({
        candidates: [
          candidate({ editions: [edition({ id: 'edition-match', isbn13: CANDIDATE_ISBN })] }),
        ],
      }),
      '/me/library': ({ body }) => {
        expect(body).toMatchObject({ editionId: 'edition-match' })
        return undefined
      },
    })

    await search(CANDIDATE_ISBN)

    expect(await screen.findByText('точний збіг за ISBN')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Це моє видання' }))

    expect(await screen.findByText('Ваш примірник')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Додати до бібліотеки' }))

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/me/library',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    expect(await screen.findByText(/тепер у вашій бібліотеці/)).toBeInTheDocument()

    // Жодного кроку створення Work/Translation/Edition не було.
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works', expect.anything())
  })
})

describe('гілка «наявне Work»', () => {
  it('веде одразу до нового Edition (+ опційний Translation), минаючи Work', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [candidate({ editions: [] })] }),
      '/works/work-1/editions': ({ body }) => {
        expect(body).toMatchObject({ translationId: null })
        return { edition: edition({ id: 'edition-new' }) }
      },
      '/me/library': ({ body }) => {
        expect(body).toMatchObject({ editionId: 'edition-new' })
        return undefined
      },
    })

    await search('Кобзар')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'У мене інше видання цього твору' }))

    expect(await screen.findByText('Переклад')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Пропустити — це оригінал' }))

    expect(await screen.findByText('Видання')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Далі: мій примірник' }))

    expect(await screen.findByText('Ваш примірник')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Додати до бібліотеки' }))

    expect(await screen.findByText(/тепер у вашій бібліотеці/)).toBeInTheDocument()

    // Регресія: гілка «наявний Work» без lookup (текстовий пошук, не ISBN)
    // працює так само, як і до додавання lookup-передачі нижче.
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works', expect.anything())
  })

  it('lookup-чернетка доходить до нового Translation/Edition, а не губиться на виборі наявного Work', async () => {
    let translationPayload: unknown
    let editionPayload: unknown

    routeApiRequest({
      '/catalog/search/candidates': () => ({
        candidates: [candidate({ editions: [], translations: [] })],
      }),
      '/catalog/lookup': () => ({
        result: {
          title: 'Ігнорується — Work наявний',
          authors: ['Ігнорується'],
          publishedYear: 2001,
          language: 'de',
          publisher: 'Видавництво з лукапу',
          coverUrl: 'https://example.com/cover.jpg',
        },
      }),
      '/works/work-1/translations': ({ body }) => {
        translationPayload = body
        return { translation: translation({ id: 'translation-new', workId: 'work-1' }) }
      },
      '/works/work-1/editions': ({ body }) => {
        editionPayload = body
        return { edition: edition({ id: 'edition-new', workId: 'work-1' }) }
      },
      '/me/library': () => undefined,
    })

    await search(CANDIDATE_ISBN)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'У мене інше видання цього твору' }))

    expect(await screen.findByText('Переклад')).toBeInTheDocument()
    // §6.3 п.12: наявний Work не редагується повторно — жодного запиту на
    // /works, і назва/автори з lookup ніде не показуються на цьому кроці.
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works', expect.anything())
    expect(screen.queryByText('Ігнорується — Work наявний')).not.toBeInTheDocument()

    // Мова видання з lookup — лише в полі мови ПЕРЕКЛАДУ.
    expect(screen.getByLabelText('Мова перекладу')).toHaveValue('de')
    expect(screen.getByLabelText('З якої мови перекладено')).toHaveValue('')

    await user.type(screen.getByLabelText('З якої мови перекладено'), 'en')
    await user.type(screen.getByLabelText('Перекладач'), 'Новий Перекладач')
    await user.click(screen.getByRole('button', { name: 'Далі: видання' }))

    expect(await screen.findByText('Видання')).toBeInTheDocument()
    expect(screen.getByLabelText('Рік видання')).toHaveValue(2001)
    expect(screen.getByLabelText('Видавництво')).toHaveValue('Видавництво з лукапу')
    expect(screen.getByLabelText('Обкладинка (посилання)')).toHaveValue(
      'https://example.com/cover.jpg',
    )
    expect(screen.getByLabelText('ISBN-13')).toHaveValue(CANDIDATE_ISBN)

    // Ручна правка після lookup зберігається — наступний рендер її не затирає.
    await user.clear(screen.getByLabelText('Видавництво'))
    await user.type(screen.getByLabelText('Видавництво'), 'Виправлене видавництво')

    await user.click(screen.getByRole('button', { name: 'Далі: мій примірник' }))

    await waitFor(() => {
      expect(translationPayload).toMatchObject({
        translator: 'Новий Перекладач',
        lang: 'de',
        sourceLang: 'en',
      })
    })
    expect(editionPayload).toMatchObject({
      year: 2001,
      publisher: 'Виправлене видавництво',
      coverUrl: 'https://example.com/cover.jpg',
      isbn13: CANDIDATE_ISBN,
      translationId: 'translation-new',
    })
  })

  it('наявний Translation можна перевикористати — новий Translation не створюється, lookup-мова його не чіпає', async () => {
    let editionPayload: unknown

    const existingTranslation = translation({
      id: 'translation-existing',
      workId: 'work-1',
      translator: 'Старий Перекладач',
      lang: 'fr',
    })

    routeApiRequest({
      '/catalog/search/candidates': () => ({
        candidates: [candidate({ editions: [], translations: [existingTranslation] })],
      }),
      '/catalog/lookup': () => ({
        // Мова lookup відрізняється від мови наявного перекладу — якби вона
        // якось потрапляла на наявний запис, це було б видно в assert нижче.
        result: { title: 'З лукапу', publishedYear: 1999, language: 'de' },
      }),
      '/works/work-1/editions': ({ body }) => {
        editionPayload = body
        return { edition: edition({ id: 'edition-new', workId: 'work-1' }) }
      },
      '/me/library': () => undefined,
    })

    await search(CANDIDATE_ISBN)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'У мене інше видання цього твору' }))

    expect(await screen.findByText('Переклад')).toBeInTheDocument()
    expect(
      screen.getByText('У цього твору вже є переклади — можливо, ваш серед них.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Старий Перекладач/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Використати цей переклад' }))

    expect(await screen.findByText('Видання')).toBeInTheDocument()
    // Дані видання все одно підставляються з lookup — лише мова переклад не
    // чіпається (наявний Translation не редагується цим флоу).
    expect(screen.getByLabelText('Рік видання')).toHaveValue(1999)

    await user.click(screen.getByRole('button', { name: 'Далі: мій примірник' }))

    await waitFor(() => {
      expect(editionPayload).toMatchObject({ translationId: 'translation-existing' })
    })

    // Жодного POST на створення нового Translation — саме наявний перевикористаний.
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works/work-1/translations', expect.anything())
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works', expect.anything())
  })
})

describe('вхід зі сторінки твору через workId', () => {
  it('показує наявні переклади твору замість пропозиції створити дублікат', async () => {
    const existingTranslation = translation({
      id: 'translation-existing',
      translator: 'Наявний Перекладач',
      lang: 'pl',
    })

    searchParams = new URLSearchParams({ workId: 'work-1' })
    routeApiRequest({
      '/works/work-1': () => candidate({ translations: [existingTranslation] }),
    })

    render(<NewBookPage />)

    expect(screen.getByText('Підготовка видання')).toBeInTheDocument()
    expect(await screen.findByText('Переклад')).toBeInTheDocument()
    expect(screen.getByText(/Наявний Перекладач/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Використати цей переклад' })).toBeInTheDocument()
  })
})

describe('гілка «наявне Edition» — lookup не впливає', () => {
  it('lookup успішний, але гілка «наявне Edition» все одно створює лише Copy', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({
        candidates: [
          candidate({ editions: [edition({ id: 'edition-match', isbn13: CANDIDATE_ISBN })] }),
        ],
      }),
      '/catalog/lookup': () => ({
        result: { title: 'Не повинно нікуди потрапити', publishedYear: 2001, language: 'de' },
      }),
      '/me/library': ({ body }) => {
        expect(body).toMatchObject({ editionId: 'edition-match' })
        return undefined
      },
    })

    await search(CANDIDATE_ISBN)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Це моє видання' }))

    expect(await screen.findByText('Ваш примірник')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Додати до бібліотеки' }))

    expect(await screen.findByText(/тепер у вашій бібліотеці/)).toBeInTheDocument()

    expect(mockApiRequest).not.toHaveBeenCalledWith('/works', expect.anything())
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works/work-1/translations', expect.anything())
    expect(mockApiRequest).not.toHaveBeenCalledWith('/works/work-1/editions', expect.anything())
  })
})

describe('гілка «немає збігів»', () => {
  it('веде повним ланцюгом Work → Translation → Edition → Copy', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [] }),
      '/works': ({ body }) => {
        expect(body).toMatchObject({ title: 'Новий твір' })
        return {
          work: work({ id: 'work-new', title: 'Новий твір' }),
          authors: [],
          translations: [],
          editions: [],
        }
      },
      '/works/work-new/editions': () => ({
        edition: edition({ id: 'edition-new', workId: 'work-new' }),
      }),
      '/me/library': () => undefined,
    })

    await search('Новий твір')

    expect(
      await screen.findByText('Нічого схожого не знайшлося. Заведемо новий твір.'),
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Створити новий твір' }))

    expect(await screen.findByText('Твір')).toBeInTheDocument()
    expect(screen.getByLabelText('Назва твору')).toHaveValue('Новий твір')

    await user.type(screen.getByLabelText('Імʼя'), 'Тестовий Автор')
    await user.click(screen.getByRole('button', { name: 'Далі: переклад' }))

    expect(await screen.findByText('Переклад')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Пропустити — це оригінал' }))

    expect(await screen.findByText('Видання')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Далі: мій примірник' }))

    expect(await screen.findByText('Ваш примірник')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Додати до бібліотеки' }))

    expect(await screen.findByText(/тепер у вашій бібліотеці/)).toBeInTheDocument()
  })

  it('підставляє дані з lookup у форму Work як редаговану чернетку', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [] }),
      '/catalog/lookup': () => ({
        result: { title: 'З лукапу', authors: ['Автор Один', 'Автор Два'], publishedYear: 2001 },
      }),
    })

    await search(CANDIDATE_ISBN)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Створити новий твір' }))

    expect(await screen.findByText('Твір')).toBeInTheDocument()
    expect(screen.getByLabelText('Назва твору')).toHaveValue('З лукапу')

    // §6.3 п.2–3: рік ISBN-видання — це Edition.year, не Work.firstPubYear.
    // Провайдер не дає окремого work-level поля, тож рік першої публікації
    // твору лишається порожнім і редагованим руками.
    expect(screen.getByLabelText('Рік першого видання')).toHaveValue(null)

    const authorNames = screen.getAllByLabelText('Імʼя')
    expect(authorNames.map((input) => (input as HTMLInputElement).value)).toEqual([
      'Автор Один',
      'Автор Два',
    ])

    // Підставлене — все ще звичайне контрольоване поле: правиться руками до збереження.
    await user.clear(screen.getByLabelText('Назва твору'))
    await user.type(screen.getByLabelText('Назва твору'), 'Виправлена назва')
    expect(screen.getByLabelText('Назва твору')).toHaveValue('Виправлена назва')
  })

  it('рік видання, видавництво, обкладинка й мова з lookup доходять до Translation/Edition — не до Work', async () => {
    let editionPayload: unknown

    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [] }),
      '/catalog/lookup': () => ({
        result: {
          title: 'З лукапу',
          authors: ['Автор Один'],
          publishedYear: 2001,
          language: 'de',
          publisher: 'Видавництво з лукапу',
          coverUrl: 'https://example.com/cover.jpg',
        },
      }),
      '/works': () => ({
        work: work({ id: 'work-new', title: 'З лукапу' }),
        authors: [],
        translations: [],
        editions: [],
      }),
      '/works/work-new/translations': () => ({
        translation: translation({ id: 'translation-new', workId: 'work-new' }),
      }),
      '/works/work-new/editions': ({ body }) => {
        editionPayload = body
        return { edition: edition({ id: 'edition-new', workId: 'work-new' }) }
      },
      '/me/library': () => undefined,
    })

    await search(CANDIDATE_ISBN)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Створити новий твір' }))

    expect(await screen.findByText('Твір')).toBeInTheDocument()
    // Work-крок не отримує ні року видання, ні мови видання — жодного поля
    // "мова" на цьому кроці взагалі немає під підказкою lookup.
    expect(screen.getByLabelText('Рік першого видання')).toHaveValue(null)

    await user.click(screen.getByRole('button', { name: 'Далі: переклад' }))

    expect(await screen.findByText('Переклад')).toBeInTheDocument()
    // §6.3 п.7: мова ISBN-видання автозаповнює саме мову перекладу…
    expect(screen.getByLabelText('Мова перекладу')).toHaveValue('de')
    // …і ніколи мову джерела: поле лишається порожнім, доки його явно не заповнять.
    expect(screen.getByLabelText('З якої мови перекладено')).toHaveValue('')
    await user.type(screen.getByLabelText('З якої мови перекладено'), 'en')
    await user.type(screen.getByLabelText('Перекладач'), 'Тестовий Перекладач')
    await user.click(screen.getByRole('button', { name: 'Далі: видання' }))

    expect(await screen.findByText('Видання')).toBeInTheDocument()
    expect(screen.getByLabelText('Рік видання')).toHaveValue(2001)
    expect(screen.getByLabelText('Видавництво')).toHaveValue('Видавництво з лукапу')
    expect(screen.getByLabelText('Обкладинка (посилання)')).toHaveValue(
      'https://example.com/cover.jpg',
    )

    // Редагування після lookup не відкочується наступним рендером.
    await user.clear(screen.getByLabelText('Видавництво'))
    await user.type(screen.getByLabelText('Видавництво'), 'Виправлене видавництво')

    await user.click(screen.getByRole('button', { name: 'Далі: мій примірник' }))

    await waitFor(() => {
      expect(editionPayload).toMatchObject({
        year: 2001,
        publisher: 'Виправлене видавництво',
        coverUrl: 'https://example.com/cover.jpg',
      })
    })
  })
})

describe('помилки провайдера й rate limiting', () => {
  it('429 на пошуку кандидатів — зрозуміле повідомлення, а не сирий текст ThrottlerException', async () => {
    const { ApiRequestError } = jest.requireActual<typeof import('@/app/lib/api')>('@/app/lib/api')

    routeApiRequest({
      '/catalog/search/candidates': () => {
        throw new ApiRequestError(429, {
          code: 'TOO_MANY_REQUESTS',
          message: 'ThrottlerException: Too Many Requests',
        })
      },
    })

    await search('Кобзар')

    expect(
      await screen.findByText('Забагато запитів поспіль. Зачекайте хвилину і спробуйте ще раз.'),
    ).toBeInTheDocument()
  })

  it('504 на lookup — некритична підказка, кандидати все одно показуються', async () => {
    const { ApiRequestError } = jest.requireActual<typeof import('@/app/lib/api')>('@/app/lib/api')

    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [] }),
      '/catalog/lookup': () => {
        throw new ApiRequestError(504, {
          code: 'CATALOG_LOOKUP_TIMEOUT',
          message: 'Зовнішній провайдер не відповів вчасно',
        })
      },
    })

    await search(CANDIDATE_ISBN)

    expect(
      await screen.findByText(
        'Зовнішній сервіс автозаповнення не відповів вчасно. Можна заповнити форму вручну.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Нічого схожого не знайшлося. Заведемо новий твір.'),
    ).toBeInTheDocument()
  })

  it('502 помилка провайдера на lookup — та сама некритична підказка', async () => {
    const { ApiRequestError } = jest.requireActual<typeof import('@/app/lib/api')>('@/app/lib/api')

    routeApiRequest({
      '/catalog/search/candidates': () => ({ candidates: [] }),
      '/catalog/lookup': () => {
        throw new ApiRequestError(502, {
          code: 'CATALOG_LOOKUP_PROVIDER_ERROR',
          message: 'Зовнішній провайдер повернув помилку: 500',
        })
      },
    })

    await search(CANDIDATE_ISBN)

    expect(
      await screen.findByText(
        'Зовнішній сервіс автозаповнення зараз недоступний. Можна заповнити форму вручну.',
      ),
    ).toBeInTheDocument()
  })
})

// Спокійний smoke-тест на найпростіший рендер, щоб `within` не лишався невикористаним
// експортом бібліотеки — придатний для точкового пошуку всередині картки кандидата.
describe('картка кандидата', () => {
  it('показує видання разом із твором', async () => {
    routeApiRequest({
      '/catalog/search/candidates': () => ({
        candidates: [candidate({ editions: [edition({ publisher: 'КСД' })] })],
      }),
    })

    await search('Кобзар')

    const item = (await screen.findByText('Кобзар')).closest('li')
    expect(item).not.toBeNull()
    expect(within(item as HTMLElement).getByText(/КСД/)).toBeInTheDocument()
  })
})
