import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

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

  // Конфіги збірки — звичайний Node/CommonJS.
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },

  // §2 обґрунтовує TypeScript 6 саме тим, що на ньому працюють type-aware правила
  // ESLint. Вмикаємо їх там, де файли вкриті tsconfig'ами пакетів.
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
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      // Заборона `any` — вимога проєкту, не рекомендація.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  prettier,
)
