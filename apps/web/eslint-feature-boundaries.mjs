// TD-01: builds the no-restricted-imports config that enforces each feature's public-interface
// boundary (CONVENTIONS.md §1.3). Exported as a function, not inlined in eslint.config.mjs, so
// the regression test in eslint-fixtures/feature-composition can exercise the exact same
// generator with synthetic feature names instead of re-implementing its logic.
//
// ESLint flat config REPLACES, not merges, a rule's options when multiple matching config
// objects set the same rule key — the last match in array order wins outright. A naive "one
// block per feature, each excluding only itself" approach breaks the moment there is more than
// one feature: every feature's block still matches every OTHER feature's files (and every
// external file), so whichever block happens to be last in the array is the only one whose
// restrictions survive for those files — every other feature is silently unprotected.
//
// The fix keeps exactly one matching block per file:
//   - one block per feature, scoped via `files` to paths strictly inside that feature,
//     restricting imports into every OTHER known feature (never itself);
//   - one shared block for everyone else (`ignores` every known feature), restricting imports
//     into ALL known features.
// A file lives inside at most one feature directory, so at most one of these blocks ever
// matches it — no last-wins collision, and an external consumer sees the union of every
// feature's restriction, not just the last one declared.

function featureBoundaryPatterns(features) {
  return features.map((feature) => ({
    group: [
      `@/${feature}/components/**`,
      `@/${feature}/hooks/**`,
      `@/${feature}/api/**`,
      `@/${feature}/model/**`,
      `@/${feature}/lib/**`,
    ],
    message: `Import ${feature} only via its public barrel (@/${feature}/index or index.client), not from outside the feature (CONVENTIONS.md §1.3).`,
  }))
}

export function buildFeatureBoundaryConfig(features) {
  const ownFeatureBlocks = features.flatMap((feature) => {
    const otherFeatures = features.filter((candidate) => candidate !== feature)
    if (otherFeatures.length === 0) {
      // Only one feature known: nothing else to restrict it from, and the shared
      // external-consumer block below already excludes the feature's own directory.
      return []
    }
    return [
      {
        files: [`${feature}/**/*.ts`, `${feature}/**/*.tsx`],
        rules: {
          'no-restricted-imports': ['error', { patterns: featureBoundaryPatterns(otherFeatures) }],
        },
      },
    ]
  })

  const externalConsumerBlock = {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: features.map((feature) => `${feature}/**`),
    rules: {
      'no-restricted-imports': ['error', { patterns: featureBoundaryPatterns(features) }],
    },
  }

  return [...ownFeatureBlocks, externalConsumerBlock]
}
