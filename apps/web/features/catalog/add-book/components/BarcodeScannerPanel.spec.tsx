/** @jest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { ScannerModules } from '../lib/barcode-scanner.client'
import { BarcodeScannerPanel } from './BarcodeScannerPanel'

type DecodeCallback = (result: { getText: () => string } | undefined) => void

function createFakeModules() {
  const stop = jest.fn()
  let capturedCallback: DecodeCallback | undefined

  class FakeReader {
    constructor(public hints: Map<unknown, unknown>) {}

    decodeFromConstraints(_constraints: unknown, _video: HTMLVideoElement, cb: DecodeCallback) {
      capturedCallback = cb
      return Promise.resolve({ stop })
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
    stop,
    emit: (text: string) => act(() => capturedCallback?.({ getText: () => text })),
  }
}

const VALID_ISBN = '9783161484100'

/** jsdom defaults `isSecureContext` to `false` — most tests need it supported. */
beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: jest.fn() },
    configurable: true,
  })
})

describe('BarcodeScannerPanel', () => {
  it('renders a start button and requests nothing on mount', () => {
    const loadScannerModules = jest.fn()
    render(<BarcodeScannerPanel onValidIsbn={jest.fn()} loadScannerModules={loadScannerModules} />)

    expect(screen.getByRole('button', { name: 'Увімкнути камеру' })).toBeInTheDocument()
    expect(loadScannerModules).not.toHaveBeenCalled()
  })

  it('loads the scanner module only after clicking start', async () => {
    const fake = createFakeModules()
    const loadScannerModules = jest.fn().mockResolvedValue(fake.modules)
    const user = userEvent.setup()
    render(<BarcodeScannerPanel onValidIsbn={jest.fn()} loadScannerModules={loadScannerModules} />)

    expect(loadScannerModules).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))

    expect(loadScannerModules).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent('Наведіть камеру на штрих-код')
  })

  it('a valid EAN-13 decode calls onValidIsbn with the normalized ISBN and stops scanning', async () => {
    const fake = createFakeModules()
    const onValidIsbn = jest.fn()
    const user = userEvent.setup()
    render(
      <BarcodeScannerPanel
        onValidIsbn={onValidIsbn}
        loadScannerModules={jest.fn().mockResolvedValue(fake.modules)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))
    await screen.findByRole('status')

    fake.emit(VALID_ISBN)

    expect(onValidIsbn).toHaveBeenCalledWith(VALID_ISBN)
    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Увімкнути камеру' })).toBeInTheDocument()
  })

  it('a decode that fails ISBN-13 validation shows an inline message and keeps scanning (no API call, no stop)', async () => {
    const fake = createFakeModules()
    const onValidIsbn = jest.fn()
    const user = userEvent.setup()
    render(
      <BarcodeScannerPanel
        onValidIsbn={onValidIsbn}
        loadScannerModules={jest.fn().mockResolvedValue(fake.modules)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))
    await screen.findByRole('status')

    fake.emit('1234567890123')

    expect(onValidIsbn).not.toHaveBeenCalled()
    expect(fake.stop).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Це не схоже на ISBN-13')
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeInTheDocument()
  })

  it('cancel stops the scanner and returns to the start state', async () => {
    const fake = createFakeModules()
    const user = userEvent.setup()
    render(
      <BarcodeScannerPanel
        onValidIsbn={jest.fn()}
        loadScannerModules={jest.fn().mockResolvedValue(fake.modules)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))
    await screen.findByRole('status')

    await user.click(screen.getByRole('button', { name: 'Скасувати' }))

    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Увімкнути камеру' })).toBeInTheDocument()
  })

  it('unmounting while scanning stops the underlying scanner', async () => {
    const fake = createFakeModules()
    const user = userEvent.setup()
    const { unmount } = render(
      <BarcodeScannerPanel
        onValidIsbn={jest.fn()}
        loadScannerModules={jest.fn().mockResolvedValue(fake.modules)}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))
    await screen.findByRole('status')

    unmount()

    expect(fake.stop).toHaveBeenCalledTimes(1)
  })

  it('shows the unsupported-browser message and never attempts to load the scanner when unsupported', async () => {
    const originalIsSecureContext = window.isSecureContext
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })

    const loadScannerModules = jest.fn()
    const user = userEvent.setup()
    render(<BarcodeScannerPanel onValidIsbn={jest.fn()} loadScannerModules={loadScannerModules} />)

    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))

    expect(loadScannerModules).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Сканування недоступне')
    expect(screen.getByRole('button', { name: 'Спробувати знову' })).toBeInTheDocument()

    Object.defineProperty(window, 'isSecureContext', {
      value: originalIsSecureContext,
      configurable: true,
    })
  })

  it('a camera error shows its message and a retry that re-arms the start button', async () => {
    const loadScannerModules = jest
      .fn()
      .mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const user = userEvent.setup()
    render(<BarcodeScannerPanel onValidIsbn={jest.fn()} loadScannerModules={loadScannerModules} />)

    await user.click(screen.getByRole('button', { name: 'Увімкнути камеру' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Доступ до камери заборонено')
    expect(screen.getByRole('button', { name: 'Спробувати знову' })).toBeInTheDocument()
  })
})
