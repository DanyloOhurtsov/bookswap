import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import prettier from 'eslint-config-prettier'

const repoRoot = import.meta.dirname

/**
 * Блоки, специфічні для apps/web.
 *
 * Винесені у функцію з префіксом шляху, бо flat config резолвить `files`
 * відносно теки свого конфіга: з кореня web-файли — це `apps/web/**`, а з
 * `apps/web/eslint.config.mjs` (він додає eslint-config-next) — просто `**`.
 * Один і той самий масив у двох базах шляхів не спрацював би: `pnpm turbo run
 * lint` мовчки не перевіряв би жодного з правил нижче, хоча кореневий
 * `eslint .` з gate.sh перевіряв би всі.
 */
export function webConfigs(prefix) {
  // Через `tseslint.config()`, а не голим масивом: блоки нижче користуються
  // ключем `extends`, який розгортає саме він, а apps/web/eslint.config.mjs
  // спредить результат у звичайний масив.
  return tseslint.config(
    // §2: type-aware правила. `projectService` бере найближчий tsconfig.json,
    // а apps/web/tsconfig.json покриває `**/*.ts` і `**/*.tsx` цілком.
    {
      files: [`${prefix}**/*.{ts,tsx}`],
      extends: [...tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: repoRoot,
        },
      },
    },

    // §1.4: default export — тільки там, де його вимагає App Router.
    {
      files: [
        `${prefix}app/**/{page,layout,template,default,error,global-error,loading,not-found}.tsx`,
        `${prefix}app/**/route.ts`,
      ],
      rules: { 'import/no-default-export': 'off' },
    },

    // §0.1 `import type`. `inline-type-imports` — бо так уже написаний увесь web
    // (`import { useState, type FormEvent } from 'react'`); дефолтний
    // `separate-type-imports` різав би такі рядки на два імпорти з одного модуля.
    //
    // Парний до цього `verbatimModuleSyntax` живе в apps/web/tsconfig.json, а не
    // в tsconfig.base.json: apps/api і packages/shared емітять CommonJS, і там цей
    // прапорець дає TS1295 на кожному ESM-імпорті, а не «пиши import type».
    {
      files: [`${prefix}**/*.{ts,tsx}`],
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
      },
    },

    // §0.3. В apps/api ці два правила поки дають 44 і 16 порушень — окремий крок.
    {
      files: [`${prefix}**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['../../*'],
                message: 'Використовуй alias @/ замість глибоких relative-шляхів',
              },
              {
                group: ['./index', '../index'],
                message: 'Файл не імпортує барел власної папки (цикли)',
              },
            ],
          },
        ],
        'max-params': ['error', 3],
      },
    },
  )
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Prisma Client. Згенеровані файли й самі несуть /* eslint-disable */, але
      // тримати їх поза проходом дешевше: це десятки тисяч рядків на кожен запуск.
      'apps/api/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Конфіги збірки — звичайний Node. `sourceType` тут не косметика: `.mjs` — це
  // ESM, і назвати їх CommonJS не можна, бо eslint-plugin-import мовчки вимикає
  // частину правил, коли sourceType !== 'module' (див. no-default-export:
  // `if (sourceType(context) !== 'module') return {}`). Один спільний блок
  // означав би, що `pnpm exec eslint .` перевіряє сам `eslint.config.mjs` вхолосту.
  //
  // Для `.js` — `script`, а не `commonjs`: у apps/web поверх цього конфіга лягає
  // eslint-config-next, який ставить на `**/*.js` парсер typescript-eslint, а той
  // приймає лише script/module/unambiguous. `module`/`require`/`exports` дає
  // globals.node, тож нічого не втрачається.
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'script',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
  },

  // §2 обґрунтовує TypeScript 6 саме тим, що на ньому працюють type-aware правила
  // ESLint. Вмикаємо їх там, де файли вкриті tsconfig'ами пакетів. Web — у
  // webConfigs() нижче, бо його блоки мусять уміти жити у двох базах шляхів.
  {
    files: [
      'apps/api/src/**/*.ts',
      'apps/api/test/**/*.ts',
      'apps/api/prisma/**/*.ts',
      'apps/api/prisma.config.ts',
      'packages/shared/src/**/*.ts',
    ],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repoRoot,
      },
    },
  },

  {
    plugins: { import: importPlugin },
    rules: {
      // Заборона `any` — вимога проєкту, не рекомендація.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // §0.3. Ці три коштують нуль порушень у всіх трьох пакетах, тож вмикаються
      // репо-широко одразу; §14 hard ban №11 (циклічні залежності) виявився вже
      // дотриманим.
      'import/no-cycle': ['error', { maxDepth: Infinity }],
      'import/no-default-export': 'error',
      'max-depth': ['error', 3],
    },
  },

  // §1.4: конфіги — той самий виняток, що й роути App Router. Перелічені явно, а
  // не «випадково не спрацювало через sourceType»: інакше правка sourceType вище
  // ламала б збірку рівно тоді, коли правило починає працювати як задумано.
  {
    files: ['**/*.config.{js,mjs,ts}', 'apps/api/test/db/global-setup.ts'],
    rules: { 'import/no-default-export': 'off' },
  },

  // §0.1 `import type` для shared. Свідомо повз apps/api: Nest будує DI на
  // design:paramtypes, і стирання type-імпортів ламає ін'єкцію в рантаймі.
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },

  ...webConfigs('apps/web/'),

  prettier,
)
