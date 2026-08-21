/**
 * Дефолт лишається `node`: більшість тестів — чиста логіка в `app/lib`, без
 * jsdom і бібліотек рендерингу (правила на кшталт ідентичності запиту в
 * `resource-state.ts` навмисно винесені у функції без React).
 *
 * Компонентні тести (Етап 7d) оголошують `/** @jest-environment jsdom *\/` у
 * своєму файлі — так важкий jsdom вантажиться лише там, де справді потрібен
 * рендер, а не глобально для всього пакета.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'app',
  testRegex: '.*\\.spec\\.tsx?$',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
}
