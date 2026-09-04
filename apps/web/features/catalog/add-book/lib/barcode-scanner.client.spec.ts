/** @jest-environment jsdom */

import {
  isScannerSupported,
  startBarcodeScanner,
  type ScannerModules,
} from './barcode-scanner.client'

type DecodeCallback = (result: { getText: () => string } | undefined) => void

/** A hand-built fake of the two `@zxing/*` packages, fully test-controlled. */
function createFakeModules() {
  const controlsStop = jest.fn()
  const decodeFromConstraints = jest.fn<
    Promise<{ stop: () => void }>,
    [unknown, HTMLVideoElement, DecodeCallback]
  >()
  let capturedCallback: DecodeCallback | undefined
  let capturedConstraints: unknown

  class FakeReader {
    constructor(public hints: Map<unknown, unknown>) {}

    decodeFromConstraints(
      constraints: unknown,
      _video: HTMLVideoElement,
      callback: DecodeCallback,
    ) {
      capturedConstraints = constraints
      capturedCallback = callback
      return decodeFromConstraints(constraints, _video, callback)
    }
  }

  const modules: ScannerModules = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double stands in for the real ZXing class
    BrowserMultiFormatReader: FakeReader as any,
    DecodeHintType: {
      POSSIBLE_FORMATS: 'POSSIBLE_FORMATS',
    } as unknown as ScannerModules['DecodeHintType'],
    BarcodeFormat: { EAN_13: 'EAN_13' } as unknown as ScannerModules['BarcodeFormat'],
  }

  return {
    modules,
    decodeFromConstraints,
    controlsStop,
    getCallback: () => capturedCallback,
    getConstraints: () => capturedConstraints,
  }
}

function createVideo(): HTMLVideoElement {
  return document.createElement('video')
}

describe('isScannerSupported', () => {
  const originalIsSecureContext = window.isSecureContext
  const originalMediaDevices = navigator.mediaDevices

  afterEach(() => {
    Object.defineProperty(window, 'isSecureContext', {
      value: originalIsSecureContext,
      configurable: true,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
  })

  it('is true in a secure context with getUserMedia available', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn() },
      configurable: true,
    })

    expect(isScannerSupported()).toBe(true)
  })

  it('is false when the context is not secure', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn() },
      configurable: true,
    })

    expect(isScannerSupported()).toBe(false)
  })

  it('is false when mediaDevices.getUserMedia is missing', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })

    expect(isScannerSupported()).toBe(false)
  })
})

describe('startBarcodeScanner', () => {
  it('calls loadScannerModules as soon as it is invoked, and passes environment-facing constraints', async () => {
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockReturnValue(new Promise(() => {}))
    const loadScannerModules = jest.fn().mockResolvedValue(fake.modules)

    startBarcodeScanner({
      video: createVideo(),
      onDecoded: jest.fn(),
      onError: jest.fn(),
      loadScannerModules,
    })

    // Synchronous: an async function body runs up to its first `await`
    // immediately, so the loader has already fired before this line.
    expect(loadScannerModules).toHaveBeenCalledTimes(1)

    await Promise.resolve()
    await Promise.resolve()

    expect(fake.getConstraints()).toEqual({ video: { facingMode: { ideal: 'environment' } } })
  })

  it('calls onDecoded with the raw text on a successful decode', async () => {
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockResolvedValue({ stop: fake.controlsStop })
    const onDecoded = jest.fn()

    startBarcodeScanner({
      video: createVideo(),
      onDecoded,
      onError: jest.fn(),
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    fake.getCallback()?.({ getText: () => '9783161484100' })

    expect(onDecoded).toHaveBeenCalledWith('9783161484100')
    // Whether to stop is the caller's decision (e.g. after validating the
    // ISBN) — the adapter itself keeps scanning until told to stop.
    expect(fake.controlsStop).not.toHaveBeenCalled()
  })

  it('ignores per-frame calls with no result (decode noise)', async () => {
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockResolvedValue({ stop: fake.controlsStop })
    const onDecoded = jest.fn()

    startBarcodeScanner({
      video: createVideo(),
      onDecoded,
      onError: jest.fn(),
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    fake.getCallback()?.(undefined)

    expect(onDecoded).not.toHaveBeenCalled()
  })

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'camera-busy'],
    ['AbortError', 'unknown'],
  ] as const)('classifies %s as %s', async (domName, reason) => {
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockRejectedValue(new DOMException('boom', domName))
    const onError = jest.fn()

    startBarcodeScanner({
      video: createVideo(),
      onDecoded: jest.fn(),
      onError,
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledWith({
      reason,
      cause: expect.any(DOMException),
    })
  })

  it('stops and reports a timeout when nothing is decoded in time', async () => {
    jest.useFakeTimers()
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockResolvedValue({ stop: fake.controlsStop })
    const onError = jest.fn()

    startBarcodeScanner({
      video: createVideo(),
      onDecoded: jest.fn(),
      onError,
      timeoutMs: 1_000,
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    jest.advanceTimersByTime(1_000)

    expect(onError).toHaveBeenCalledWith({ reason: 'timeout' })
    jest.useRealTimers()
  })

  it('stop() before the import resolves prevents any late callback from firing', async () => {
    const fake = createFakeModules()
    let resolveModules: ((modules: ScannerModules) => void) | undefined
    const loadScannerModules = jest.fn(
      () =>
        new Promise<ScannerModules>((resolve) => {
          resolveModules = resolve
        }),
    )
    const onDecoded = jest.fn()
    const onError = jest.fn()
    const video = createVideo()

    const handle = startBarcodeScanner({ video, onDecoded, onError, loadScannerModules })
    handle.stop()

    fake.decodeFromConstraints.mockResolvedValue({ stop: fake.controlsStop })
    resolveModules?.(fake.modules)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // stop() happened before the module ever resolved: decode was never started.
    expect(fake.decodeFromConstraints).not.toHaveBeenCalled()
    expect(onDecoded).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('a decode session that resolves after stop() still gets its own controls stopped (no leaked camera)', async () => {
    const fake = createFakeModules()
    let resolveDecode: ((controls: { stop: () => void }) => void) | undefined
    fake.decodeFromConstraints.mockReturnValue(
      new Promise((resolve) => {
        resolveDecode = resolve
      }),
    )
    const video = createVideo()
    // Simulates ZXing having already attached the stream before its promise settles.
    const track = { stop: jest.fn() }
    video.srcObject = { getTracks: () => [track] } as unknown as MediaProvider

    const handle = startBarcodeScanner({
      video,
      onDecoded: jest.fn(),
      onError: jest.fn(),
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(fake.decodeFromConstraints).toHaveBeenCalledTimes(1)

    handle.stop()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()

    resolveDecode?.({ stop: fake.controlsStop })
    await Promise.resolve()
    await Promise.resolve()

    expect(fake.controlsStop).toHaveBeenCalledTimes(1)
  })

  it('stop() is idempotent — a second call does not stop the controls again', async () => {
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockResolvedValue({ stop: fake.controlsStop })

    const handle = startBarcodeScanner({
      video: createVideo(),
      onDecoded: jest.fn(),
      onError: jest.fn(),
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    handle.stop()
    handle.stop()

    expect(fake.controlsStop).toHaveBeenCalledTimes(1)
  })

  it('stops all MediaStreamTrack instances on the video element when stopping', async () => {
    const fake = createFakeModules()
    fake.decodeFromConstraints.mockResolvedValue({ stop: fake.controlsStop })
    const trackA = { stop: jest.fn() }
    const trackB = { stop: jest.fn() }
    const video = createVideo()
    video.srcObject = { getTracks: () => [trackA, trackB] } as unknown as MediaProvider

    const handle = startBarcodeScanner({
      video,
      onDecoded: jest.fn(),
      onError: jest.fn(),
      loadScannerModules: jest.fn().mockResolvedValue(fake.modules),
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    handle.stop()

    expect(trackA.stop).toHaveBeenCalledTimes(1)
    expect(trackB.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })
})
