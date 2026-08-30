import next from 'eslint-config-next/core-web-vitals'
import base, { webConfigs } from '../../eslint.config.mjs'

// `webConfigs('')` — не дублювання: у кореневому конфізі ті самі блоки підключені
// з префіксом `apps/web/`, який тут, де базою шляхів є сама тека apps/web, не
// збігається з жодним файлом. Без цього рядка пакетний lint перевіряв би менше,
// ніж кореневий `eslint .` у gate.sh.
const config = [...base, ...next, ...webConfigs(''), { ignores: ['.next/**', 'next-env.d.ts'] }]

export default config
