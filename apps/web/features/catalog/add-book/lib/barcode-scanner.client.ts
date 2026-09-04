import 'client-only'

/**
 * R2: реальні `@zxing/*` пакети завантажуються лише тут, і лише всередині
 * `startBarcodeScanner` — тобто після explicit user gesture, ніколи на
 * module-scope чи в ефекті. `loadScannerModules` — єдина ін'єкційна точка
 * для тестів: dynamic `import()` під `nodenext` (tsconfig.spec.json) не
 * гарантовано перехоплюється `jest.mock`, тож тести підміняють завантажувач
 * напряму, а production-шлях лишається справжнім lazy import обох пакетів.
 */

export type BarcodeScanErrorReason =
  'permission-denied' | 'no-camera' | 'camera-busy' | 'unsupported' | 'timeout' | 'unknown'

export type BarcodeScanError = { reason: BarcodeScanErrorReason; cause?: unknown }

type BrowserModule = typeof import('@zxing/browser')
type LibraryModule = typeof import('@zxing/library')

export type ScannerModules = {
  BrowserMultiFormatReader: BrowserModule['BrowserMultiFormatReader']
  DecodeHintType: LibraryModule['DecodeHintType']
  BarcodeFormat: LibraryModule['BarcodeFormat']
}

export type StartScannerOptions = {
  video: HTMLVideoElement
  onDecoded: (rawText: string) => void
  onError: (error: BarcodeScanError) => void
  timeoutMs?: number
  loadScannerModules?: () => Promise<ScannerModules>
}

export type ScannerHandle = { stop: () => void }

const DEFAULT_TIMEOUT_MS = 20_000

async function defaultLoadScannerModules(): Promise<ScannerModules> {
  const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])

  return { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat }
}

export function isScannerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined
  )
}

/**
 * Duck-typed rather than `instanceof MediaStream`: jsdom (used by component
 * tests) doesn't define a global `MediaStream`, and this still recognizes any
 * real browser `MediaStream` correctly.
 */
function stopVideoTracks(video: HTMLVideoElement): void {
  const stream = video.srcObject

  if (stream !== null && stream !== undefined && 'getTracks' in stream) {
    for (const track of stream.getTracks()) track.stop()
  }

  video.srcObject = null
}

function classifyError(error: unknown): BarcodeScanError {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return { reason: 'permission-denied', cause: error }
      case 'NotFoundError':
      case 'OverconstrainedError':
      case 'DevicesNotFoundError':
        return { reason: 'no-camera', cause: error }
      case 'NotReadableError':
      case 'TrackStartError':
        return { reason: 'camera-busy', cause: error }
      default:
        return { reason: 'unknown', cause: error }
    }
  }

  return { reason: 'unknown', cause: error }
}

/**
 * Синхронно повертає `ScannerHandle` ще до того, як резолвиться dynamic
 * import чи `getUserMedia` — cancel/unmount завжди спрацьовує негайно.
 * `stopped` замикається окремо на кожен виклик, тож застарілий колбек від
 * попередньої сесії фізично не може вплинути на стан новішої.
 */
export function startBarcodeScanner(options: StartScannerOptions): ScannerHandle {
  const {
    video,
    onDecoded,
    onError,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    loadScannerModules = defaultLoadScannerModules,
  } = options

  let stopped = false
  let controls: { stop: () => void } | undefined

  function stop(): void {
    if (stopped) return
    stopped = true

    clearTimeout(timeoutId)
    controls?.stop()
    stopVideoTracks(video)
  }

  const timeoutId = setTimeout(() => {
    if (stopped) return
    stop()
    onError({ reason: 'timeout' })
  }, timeoutMs)

  void (async () => {
    try {
      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await loadScannerModules()
      if (stopped) return

      const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]]])
      const reader = new BrowserMultiFormatReader(hints)

      const scanControls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result) => {
          if (stopped) return
          if (result === undefined) return

          // Whether to keep scanning (invalid decode) or stop (valid ISBN)
          // is the caller's call, not the adapter's — it just reports.
          onDecoded(result.getText())
        },
      )

      if (stopped) {
        scanControls.stop()
        stopVideoTracks(video)
        return
      }

      controls = scanControls
    } catch (error) {
      if (stopped) return
      stop()
      onError(classifyError(error))
    }
  })()

  return { stop }
}
