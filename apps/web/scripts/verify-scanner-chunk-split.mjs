#!/usr/bin/env node
/**
 * One-off build-inspection script (not wired into CI/gate.sh) — evidence for
 * Stage 8d's bundle-split requirement: `@zxing/*` must never be part of the
 * `/catalog/new` route's initial client chunk graph, only reachable via the
 * scanner's own dynamic `import()`.
 *
 * A repo-wide `grep -r "@zxing/browser"` would trivially "pass" since the
 * lazy chunk legitimately contains it — this instead cross-references chunk
 * *identity* against the route's own client-reference manifest.
 *
 * Usage: `pnpm --filter @bookswap/web build && node scripts/verify-scanner-chunk-split.mjs`
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const webRoot = new URL('..', import.meta.url).pathname
const chunksDir = join(webRoot, '.next/static/chunks')
const manifestPath = join(
  webRoot,
  '.next/server/app/(pages)/catalog/new/page_client-reference-manifest.js',
)

function findZxingChunks() {
  const found = []
  for (const file of readdirSync(chunksDir)) {
    if (!file.endsWith('.js')) continue
    const content = readFileSync(join(chunksDir, file), 'utf8')
    if (content.includes('BrowserMultiFormatReader')) found.push(file)
  }
  return found
}

function collectRouteChunks() {
  const source = readFileSync(manifestPath, 'utf8')
  const globalThisStub = { __RSC_MANIFEST: {} }
  // The manifest is a plain script assigning to `globalThis.__RSC_MANIFEST[...]`.
  new Function('globalThis', source)(globalThisStub)

  const routeManifest = globalThisStub.__RSC_MANIFEST['/(pages)/catalog/new/page']
  const chunkFiles = new Set()

  for (const entry of Object.values(routeManifest.clientModules)) {
    for (const chunk of entry.chunks ?? []) {
      chunkFiles.add(chunk.replace('/_next/static/chunks/', ''))
    }
  }

  return chunkFiles
}

const zxingChunks = findZxingChunks()
const routeChunks = collectRouteChunks()
const overlap = zxingChunks.filter((chunk) => routeChunks.has(chunk))

console.log(`Chunks containing @zxing/browser code: ${zxingChunks.join(', ') || '(none found)'}`)
console.log(`/catalog/new initial route chunks: ${routeChunks.size} files`)
console.log(`Overlap: ${overlap.length === 0 ? 'none' : overlap.join(', ')}`)

if (zxingChunks.length === 0) {
  console.error(
    'FAIL: no chunk containing @zxing/browser code was found at all — did the build run?',
  )
  process.exit(1)
}

if (overlap.length > 0) {
  console.error('FAIL: scanner code is part of the initial /catalog/new chunk graph.')
  process.exit(1)
}

console.log('PASS: scanner chunk(s) are lazy — not part of the initial /catalog/new bundle.')
