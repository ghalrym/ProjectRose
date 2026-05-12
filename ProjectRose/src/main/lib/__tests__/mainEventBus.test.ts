import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emitToRenderer, _setGetWindowsForTest } from '../mainEventBus'

type SendFn = (channel: string, payload: unknown) => void
interface FakeWindow { webContents: { send: SendFn & ReturnType<typeof vi.fn> } }

function makeWindow(): FakeWindow {
  return { webContents: { send: vi.fn<SendFn>() } }
}

describe('emitToRenderer', () => {
  let windows: FakeWindow[]

  beforeEach(() => {
    windows = []
    _setGetWindowsForTest(() => windows)
  })

  afterEach(() => {
    _setGetWindowsForTest(null)
  })

  it('sends the channel and payload to the first window', () => {
    const w = makeWindow()
    windows = [w]
    emitToRenderer('test:channel', { hello: 'world' })
    expect(w.webContents.send).toHaveBeenCalledWith('test:channel', { hello: 'world' })
  })

  it('no-ops when there are no open windows', () => {
    expect(() => emitToRenderer('test:channel', null)).not.toThrow()
  })

  it('only sends to the first window when multiple exist', () => {
    const a = makeWindow()
    const b = makeWindow()
    windows = [a, b]
    emitToRenderer('c', 1)
    expect(a.webContents.send).toHaveBeenCalledOnce()
    expect(b.webContents.send).not.toHaveBeenCalled()
  })

  it('forwards undefined payloads unchanged', () => {
    const w = makeWindow()
    windows = [w]
    emitToRenderer('c', undefined)
    expect(w.webContents.send).toHaveBeenCalledWith('c', undefined)
  })
})
