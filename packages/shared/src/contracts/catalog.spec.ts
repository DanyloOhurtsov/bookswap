import {
  CATALOG_LIMITS,
  SEARCH_CANDIDATES_LIMIT,
  catalogSearchRequestSchema,
  createEditionRequestSchema,
  createTranslationRequestSchema,
  createWorkRequestSchema,
  editionSchema,
  searchCandidatesResponseSchema,
  translationSchema,
} from './catalog'

const work = {
  title: 'Шантарам',
  origLang: 'en',
  authors: [{ name: 'Ґреґорі Девід Робертс' }],
}

describe('createWorkRequestSchema', () => {
  it('приймає мінімальний твір з одним новим автором', () => {
    expect(createWorkRequestSchema.parse(work).authors).toHaveLength(1)
  })

  it('приймає посилання на наявного автора', () => {
    const parsed = createWorkRequestSchema.parse({
      ...work,
      authors: [{ authorId: 'author-1', role: 'AUTHOR' }],
    })

    expect(parsed.authors[0]?.authorId).toBe('author-1')
  })

  it('вимагає РІВНО одне з authorId / name — тезки не зводяться автоматично', () => {
    expect(
      createWorkRequestSchema.safeParse({ ...work, authors: [{ authorId: 'a-1', name: 'Хтось' }] })
        .success,
    ).toBe(false)
    expect(
      createWorkRequestSchema.safeParse({ ...work, authors: [{ role: 'EDITOR' }] }).success,
    ).toBe(false)
  })

  it('вимагає хоча б одного автора', () => {
    expect(createWorkRequestSchema.safeParse({ ...work, authors: [] }).success).toBe(false)
  })

  it('повертає придатне для форми повідомлення про порожнє імʼя автора', () => {
    const result = createWorkRequestSchema.safeParse({ ...work, authors: [{ name: '' }] })

    expect(result.error?.issues[0]?.message).toBe('Не вказано імʼя автора')
  })

  it('відхиляє більше за стелю авторів', () => {
    const authors = Array.from({ length: CATALOG_LIMITS.authorsMax + 1 }, (_, index) => ({
      name: `Автор ${String(index)}`,
    }))

    expect(createWorkRequestSchema.safeParse({ ...work, authors }).success).toBe(false)
  })

  it('валідує origLang як ISO 639-1', () => {
    expect(createWorkRequestSchema.safeParse({ ...work, origLang: 'zz' }).success).toBe(false)
    expect(createWorkRequestSchema.parse({ ...work, origLang: ' EN ' }).origLang).toBe('en')
  })

  it('обрізає назву й відхиляє порожню', () => {
    expect(createWorkRequestSchema.parse({ ...work, title: '  Шантарам  ' }).title).toBe('Шантарам')
    expect(createWorkRequestSchema.safeParse({ ...work, title: '   ' }).success).toBe(false)
  })

  it('тримає рік у розумних межах, але пускає до нашої ери', () => {
    expect(createWorkRequestSchema.safeParse({ ...work, firstPubYear: -750 }).success).toBe(true)
    expect(createWorkRequestSchema.safeParse({ ...work, firstPubYear: 2_500 }).success).toBe(false)
    expect(createWorkRequestSchema.safeParse({ ...work, firstPubYear: 2003.5 }).success).toBe(false)
  })
})

describe('createTranslationRequestSchema', () => {
  const translation = { translator: 'Олександр Мокровольський', lang: 'uk', sourceLang: 'en' }

  it('приймає переклад із мовою-джерелом (§10.3)', () => {
    expect(createTranslationRequestSchema.parse(translation)).toMatchObject(translation)
  })

  it('вимагає перекладача', () => {
    expect(
      createTranslationRequestSchema.safeParse({ ...translation, translator: '  ' }).success,
    ).toBe(false)
  })

  it('валідує обидві мови', () => {
    expect(createTranslationRequestSchema.safeParse({ ...translation, lang: 'zz' }).success).toBe(
      false,
    )
    expect(
      createTranslationRequestSchema.safeParse({ ...translation, sourceLang: 'zz' }).success,
    ).toBe(false)
  })
})

describe('createEditionRequestSchema', () => {
  it('приймає порожнє тіло — видання мовою оригіналу без відомих деталей', () => {
    expect(createEditionRequestSchema.safeParse({}).success).toBe(true)
  })

  it('нормалізує ISBN і перевіряє контрольну суму', () => {
    expect(createEditionRequestSchema.parse({ isbn13: '978-3-16-148410-0' }).isbn13).toBe(
      '9783161484100',
    )
    expect(createEditionRequestSchema.safeParse({ isbn13: '978-3-16-148410-1' }).success).toBe(
      false,
    )
  })

  it('дозволяє явний null для ISBN — «номера немає» це не «поле забули»', () => {
    expect(createEditionRequestSchema.parse({ isbn13: null }).isbn13).toBeNull()
  })

  it('відхиляє непозитивну кількість сторінок і не-URL обкладинку', () => {
    expect(createEditionRequestSchema.safeParse({ pageCount: 0 }).success).toBe(false)
    expect(createEditionRequestSchema.safeParse({ coverUrl: 'не посилання' }).success).toBe(false)
  })
})

describe('catalogSearchRequestSchema', () => {
  it('вимагає щонайменше два символи', () => {
    expect(catalogSearchRequestSchema.safeParse({ q: 'ш' }).success).toBe(false)
    expect(catalogSearchRequestSchema.parse({ q: '  шан  ' }).q).toBe('шан')
  })
})

describe('проєкції', () => {
  it('translationSchema не віддає ранг — правило cold start §10.3 приїде з етапом оцінок', () => {
    const parsed = translationSchema.parse({
      id: 't-1',
      workId: 'w-1',
      translator: 'Хтось',
      lang: 'uk',
      sourceLang: 'en',
      year: null,
      isAbridged: false,
      hasNotes: true,
      notes: null,
      editionCount: 2,
      score: 4.9,
      ratingAvg: 4.9,
    })

    expect(parsed).not.toHaveProperty('score')
    expect(parsed).not.toHaveProperty('ratingAvg')
  })

  it('editionSchema несе обчислені lang і translator', () => {
    const parsed = editionSchema.parse({
      id: 'e-1',
      workId: 'w-1',
      translationId: null,
      publisher: null,
      year: null,
      isbn13: null,
      pageCount: null,
      coverUrl: null,
      format: 'PAPERBACK',
      lang: 'en',
      translator: null,
    })

    expect(parsed.lang).toBe('en')
    expect(parsed.translator).toBeNull()
  })
})

describe('searchCandidatesResponseSchema', () => {
  const workDetail = {
    work: {
      id: 'w-1',
      title: 'Шантарам',
      origLang: 'en',
      firstPubYear: 2003,
      description: null,
      createdAt: new Date().toISOString(),
    },
    authors: [],
    translations: [],
    editions: [],
  }

  it('приймає кандидата у формі WorkDetailResponse', () => {
    const parsed = searchCandidatesResponseSchema.parse({ candidates: [workDetail] })

    expect(parsed.candidates[0]?.work.id).toBe('w-1')
  })

  it('не пропускає більше кандидатів, ніж SEARCH_CANDIDATES_LIMIT', () => {
    const candidates = Array.from({ length: SEARCH_CANDIDATES_LIMIT + 1 }, () => workDetail)

    expect(searchCandidatesResponseSchema.safeParse({ candidates }).success).toBe(false)
  })
})
