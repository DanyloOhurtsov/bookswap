import tseslint from 'typescript-eslint'
import { buildFeatureBoundaryConfig } from '../../eslint-feature-boundaries.mjs'

// TD-01 regression fixture: exercises `buildFeatureBoundaryConfig` — the exact same generator
// production apps/web/eslint.config.mjs uses — with two synthetic, obviously-fake feature
// names, so composition/last-config-wins bugs with >1 feature surface in a test without
// creating a real second product feature.
const TEST_FEATURES = ['features/fixture-feature-a', 'features/fixture-feature-b']

export default tseslint.config(
  ...tseslint.configs.recommended,
  ...buildFeatureBoundaryConfig(TEST_FEATURES),
)
