import { LANGUAGE_CODES, isLanguageCode, languageCodeSchema } from './language'

describe('LANGUAGE_CODES', () => {
  it('містить усі 184 коди ISO 639-1', () => {
    expect(LANGUAGE_CODES).toHaveLength(184)
  })

  it('не має дублікатів', () => {
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length)
  })

  it('усі коди — рівно дві малі літери', () => {
    expect(LANGUAGE_CODES.filter((code) => !/^[a-z]{2}$/.test(code))).toEqual([])
  })

  it('містить мови, які реально трапляться в цьому каталозі', () => {
    for (const code of ['uk', 'en', 'pl', 'de', 'fr', 'ja']) {
      expect(isLanguageCode(code)).toBe(true)
    }
  })
})

describe('languageCodeSchema', () => {
  it('нормалізує регістр і пробіли до перевірки', () => {
    expect(languageCodeSchema.parse(' UK ')).toBe('uk')
  })

  it('відхиляє дві літери, які не є кодом мови — заради цього тут список, а не регулярка', () => {
    expect(languageCodeSchema.safeParse('zz').success).toBe(false)
    expect(languageCodeSchema.safeParse('xx').success).toBe(false)
  })

  it('відхиляє трибуквений код: §4.4 називає саме 639-1', () => {
    expect(languageCodeSchema.safeParse('ukr').success).toBe(false)
  })

  it('відхиляє порожній рядок', () => {
    expect(languageCodeSchema.safeParse('').success).toBe(false)
  })
})
