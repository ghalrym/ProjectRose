import { vi, describe, it, expect, beforeEach } from 'vitest'

// Per-file mock — overrides the global electron stub in
// `src/test/setup-electron-mock.ts` so we can drive a real handler/invoke
// round-trip through the manifest. Hoisted by vitest above the import below.
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void => {
      handlers.set(channel, (...args) => listener({}, ...args))
    }
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`No handler registered for ${channel}`)
      return await fn(...args)
    }
  }
}))

import { defineIpc, method } from '../ipc/defineIpc'

beforeEach(() => {
  handlers.clear()
})

describe('defineIpc', () => {
  it('registers ipcMain handlers under namespace:method channels', () => {
    const manifest = defineIpc('test', {
      ping: method<[], string>(),
      add: method<[number, number], number>()
    })
    manifest.register({
      ping: () => 'pong',
      add: (a, b) => a + b
    })

    expect(handlers.has('test:ping')).toBe(true)
    expect(handlers.has('test:add')).toBe(true)
  })

  it('round-trips a call through bindings → invoke → handler → result', async () => {
    const manifest = defineIpc('math', {
      add: method<[number, number], number>(),
      reverse: method<[string], string>()
    })
    manifest.register({
      add: (a, b) => a + b,
      reverse: (s) => s.split('').reverse().join('')
    })

    await expect(manifest.bindings.add(2, 3)).resolves.toBe(5)
    await expect(manifest.bindings.reverse('hello')).resolves.toBe('olleh')
  })

  it('awaits handlers that return a Promise', async () => {
    const manifest = defineIpc('async', {
      fetch: method<[string], { url: string; status: number }>()
    })
    manifest.register({
      fetch: async (url) => ({ url, status: 200 })
    })

    await expect(manifest.bindings.fetch('https://example.com')).resolves.toEqual({
      url: 'https://example.com',
      status: 200
    })
  })

  it('propagates handler rejections back through invoke', async () => {
    const manifest = defineIpc('err', {
      boom: method<[], void>()
    })
    manifest.register({
      boom: () => {
        throw new Error('handler exploded')
      }
    })

    await expect(manifest.bindings.boom()).rejects.toThrow('handler exploded')
  })

  it('exposes the declared namespace and method names', () => {
    const manifest = defineIpc('foo', {
      bar: method<[], void>(),
      baz: method<[number], string>()
    })

    expect(manifest.namespace).toBe('foo')
    expect([...manifest.methodNames].sort()).toEqual(['bar', 'baz'])
  })
})
