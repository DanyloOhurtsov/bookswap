import path from 'node:path'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import'

// Absolute, not `import.meta.dirname`-relative-string: every per-package `lint` script runs
// with cwd set to that package's own directory (`apps/web`, `apps/api`, `packages/shared`),
// not the repo root. Anything derived from this constant stays correct regardless of which
// package's `lint` script invoked ESLint — see the `import/resolver` comment below for the
// concrete case this fixes.
const ROOT_DIR = import.meta.dirname

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Prisma Client. The generated files carry their own /* eslint-disable */, but keeping
      // them out of the pass entirely is cheaper: tens of thousands of lines on every run.
      'apps/api/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Build configs — plain Node/CommonJS.
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },

  // §2 justifies TypeScript 6 precisely because it's what makes ESLint's type-aware rules
  // work. Enabled only where files are covered by a package's own tsconfig.
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
      // `any` ban — a project requirement, not a recommendation.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // TD-01, §0.3: `import/no-cycle` for all TypeScript code in the monorepo. `files` here is
  // deliberately written without a directory prefix (`apps/...`, `packages/...`): flat config
  // resolves `files` globs relative to the directory of whichever config file ESLint actually
  // loaded — for apps/web that's apps/web/eslint.config.mjs, not the repo root — so a
  // root-relative pattern would silently stop matching exactly where it matters most.
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { import: importPlugin },
    settings: {
      // eslint-plugin-import only parses a resolved file to look for cycles if its extension
      // is in this list; it defaults to `['.js', '.mjs', '.cjs']`, which excludes `.ts`/`.tsx`
      // entirely. apps/web happens to work without this because eslint-config-next separately
      // sets `import/parsers` (which also feeds the same extension check) — but apps/api and
      // packages/shared have no such config, so without this setting `import/no-cycle` silently
      // never opens a single `.ts` file there: no crash, no violation, just nothing checked.
      'import/extensions': ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.d.ts'],
      'import/resolver': {
        typescript: {
          // Absolute paths, not root-relative strings. eslint-import-resolver-typescript
          // resolves relative `project` entries against `process.cwd()` (its own internal
          // logic, unrelated to ESLint's config-relative `files` matching above), and every
          // per-package `lint` script runs with cwd set to that package's own directory. A
          // relative path here would resolve differently — or to a nonexistent file — depending
          // on which package's `lint` script is running.
          project: [
            path.join(ROOT_DIR, 'apps/web/tsconfig.json'),
            path.join(ROOT_DIR, 'apps/api/tsconfig.json'),
            path.join(ROOT_DIR, 'packages/shared/tsconfig.json'),
          ],
        },
      },
    },
    rules: {
      'import/no-cycle': ['error', { maxDepth: Infinity }],
    },
  },

  prettier,
)
