import { z } from 'zod'

/**
 * ISO 639-1, усі 184 коди.
 *
 * Список, а не `/^[a-z]{2}$/`: домен тут явно багатомовний (`origLang`, `lang`,
 * `sourceLang` — §4.4), і саме тому «zz» чи «xx» мусять відхилятися. Регулярка
 * пропустила б будь-які дві літери, а виправити мову вже заведеного твору немає
 * чим: редагування метаданих поза межами v1 (§6.3).
 *
 * Двобуквений набір, а не 639-3: §4.4 називає саме 639-1, а трибуквені коди
 * розрізняють діалекти, яких у каталозі домашніх книжок не буває.
 *
 * Рядком, а не масивом літералів: 184 елементи Prettier розкладе по рядку на
 * кожен, і файл перестане читатися. Тут же видно групування за першою літерою.
 */
const CODES = `
  aa ab ae af ak am an ar as av ay az
  ba be bg bh bi bm bn bo br bs
  ca ce ch co cr cs cu cv cy
  da de dv dz
  ee el en eo es et eu
  fa ff fi fj fo fr fy
  ga gd gl gn gu gv
  ha he hi ho hr ht hu hy hz
  ia id ie ig ii ik io is it iu
  ja jv
  ka kg ki kj kk kl km kn ko kr ks ku kv kw ky
  la lb lg li ln lo lt lu lv
  mg mh mi mk ml mn mr ms mt my
  na nb nd ne ng nl nn no nr nv ny
  oc oj om or os
  pa pi pl ps pt
  qu
  rm rn ro ru rw
  sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw
  ta te tg th ti tk tl tn to tr ts tt tw ty
  ug uk ur uz
  ve vi vo
  wa wo
  xh
  yi yo
  za zh zu
`

export const LANGUAGE_CODES: readonly string[] = CODES.trim().split(/\s+/)

// Set, а не `includes` по масиву: перевірка викликається на кожне поле мови в
// кожному запиті, і лінійний пошук по 184 елементах тут безпідставний.
const LANGUAGE_CODE_SET: ReadonlySet<string> = new Set(LANGUAGE_CODES)

export function isLanguageCode(value: string): boolean {
  return LANGUAGE_CODE_SET.has(value)
}

/**
 * Нормалізація йде ДО перевірки — так само, як в `emailSchema`: « UK » з форми
 * чи автопідстановки має стати `uk`, а не бути відхиленим як невідома мова.
 *
 * `z.enum(LANGUAGE_CODES)` не використовується навмисно: він друкує всі 184
 * значення в тексті помилки, і повідомлення перестає бути читабельним.
 */
export const languageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isLanguageCode, 'Невідомий код мови — потрібен ISO 639-1, напр. «uk» або «en»')
