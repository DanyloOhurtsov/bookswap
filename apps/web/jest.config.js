/**
 * Тести лише для чистої логіки в `app/lib` — без jsdom, React і бібліотек
 * рендерингу.
 *
 * `testEnvironment: 'node'` тут не економія, а межа: усе, що вимагає справжнього
 * рендеру, у цьому пакеті не тестується, тож і ваги під нього не тягнеться.
 * Правила, які варто закріпити (наприклад ідентичність запиту в
 * `resource-state.ts`), навмисно винесені у функції без React.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'app',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
}
