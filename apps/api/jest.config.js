/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // Корінь — увесь пакет, а не лише src: fail-closed перевірка тестової бази
  // (test/db/guard.ts) чиста й покривається unit-тестами, які не потребують
  // PostgreSQL. Регулярка навмисно вимагає крапку перед `spec`, тож `.e2e-spec.ts`
  // і `.db-spec.ts` сюди не потрапляють — вони живуть у `pnpm test:db`.
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/generated/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
}
