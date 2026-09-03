import type { ComponentType } from 'react'
import type { BarcodeScannerPanelProps } from '../components/BarcodeScannerPanel'

/**
 * A named loader module (not an inline `() => import(...)` closure in
 * `SearchStep.tsx`) is required so tests can `jest.mock` this whole module
 * by path — `next/dynamic`'s loader argument otherwise contains a real
 * dynamic `import()`, which throws under this project's ts-jest config
 * (`module: nodenext`) without `--experimental-vm-modules`.
 */
export function loadBarcodeScannerPanel(): Promise<ComponentType<BarcodeScannerPanelProps>> {
  return import('../components/BarcodeScannerPanel').then((mod) => mod.BarcodeScannerPanel)
}
