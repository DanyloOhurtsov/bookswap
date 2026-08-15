import next from 'eslint-config-next/core-web-vitals'
import base from '../../eslint.config.mjs'

export default [
  ...base,
  ...next,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
]
