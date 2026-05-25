import { describe, it, expect, vi } from 'vitest'
import { buildContext, listGrantedMethods, CAPABILITY_TO_METHOD, type HostExtensionSurface } from '../buildContext'
import type { ExtensionManifest } from '../../../shared/extension-types'

function makeHost(): HostExtensionSurface {
  return {
    rootPath: '/proj',
    getSettings: vi.fn(async () => ({ k: 'v' })),
    updateSettings: vi.fn(async () => {}),
    registerSensitiveFields: vi.fn(),
    broadcast: vi.fn(),
    notifyStatus: vi.fn(),
    registerTools: vi.fn(),
    registerHooks: vi.fn(),
    runBackgroundAgent: vi.fn(async () => 'ok'),
    runDetachedRunWithTools: vi.fn(async () => ({
      entries: [],
      finalText: '',
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      modelDisplay: 'mock'
    })),
    openAgentSession: vi.fn(() => ({
      send: async () => 'r',
      close: () => {}
    }))
  }
}

function manifest(provides: ExtensionManifest['provides']): ExtensionManifest {
  return {
    id: 'rose-fake',
    name: 'Fake',
    version: '1.0.0',
    description: 'd',
    author: 'a',
    provides
  }
}

describe('buildContext', () => {
  describe('always-present surface', () => {
    it('always exposes rootPath, getSettings, updateSettings', () => {
      const ctx = buildContext({
        extensionId: 'rose-fake',
        manifest: manifest({}),
        host: makeHost()
      })
      expect(ctx.rootPath).toBe('/proj')
      expect(typeof ctx.getSettings).toBe('function')
      expect(typeof ctx.updateSettings).toBe('function')
    })

    it('always-present methods work even with zero capabilities', async () => {
      const host = makeHost()
      const ctx = buildContext({
        extensionId: 'rose-fake',
        manifest: manifest({}),
        host
      })
      await ctx.getSettings()
      expect(host.getSettings).toHaveBeenCalled()
      await ctx.updateSettings({ foo: 'bar' })
      expect(host.updateSettings).toHaveBeenCalledWith({ foo: 'bar' })
    })
  })

  describe('UI-only manifest (no main-process capabilities)', () => {
    it('all gated methods throw with a clear missing-capability error', () => {
      const ctx = buildContext({
        extensionId: 'rose-fake',
        manifest: manifest({ pageView: true }),
        host: makeHost()
      })
      expect(() => ctx.broadcast('x', null)).toThrow(/broadcast.*not declared/)
      expect(() => ctx.notifyStatus('hi')).toThrow(/notifyStatus.*not declared/)
      expect(() => ctx.registerTools([])).toThrow(/agentTools.*not declared/)
      expect(() => ctx.registerHooks([])).toThrow(/chatHooks.*not declared/)
      expect(() => ctx.runBackgroundAgent('p', 's')).toThrow(/backgroundAgent.*not declared/)
      expect(() => ctx.openAgentSession({ systemPrompt: 's' })).toThrow(/agentSession.*not declared/)
    })

    it('error message names the extension and the missing capability', () => {
      const ctx = buildContext({
        extensionId: 'rose-git',
        manifest: manifest({ pageView: true }),
        host: makeHost()
      })
      try {
        ctx.broadcast('x', null)
        throw new Error('should not reach')
      } catch (e) {
        expect((e as Error).message).toContain('rose-git')
        expect((e as Error).message).toContain('broadcast')
        expect((e as Error).message).toContain('rose-extension.json')
      }
    })
  })

  describe('rose-git-shaped manifest (pageView + broadcast)', () => {
    it('broadcast works, other gated methods still throw', () => {
      const host = makeHost()
      const ctx = buildContext({
        extensionId: 'rose-git',
        manifest: manifest({ pageView: true, main: true, broadcast: true }),
        host
      })
      ctx.broadcast('rose-git:changed', { cwd: '/p' })
      expect(host.broadcast).toHaveBeenCalledWith('rose-git:changed', { cwd: '/p' })
      expect(() => ctx.registerHooks([])).toThrow()
      expect(() => ctx.registerTools([])).toThrow()
    })
  })

  describe('hooks-only manifest', () => {
    it('registerHooks works, registerTools throws', () => {
      const host = makeHost()
      const ctx = buildContext({
        extensionId: 'rose-qwen',
        manifest: manifest({ main: true, chatHooks: true }),
        host
      })
      ctx.registerHooks([])
      expect(host.registerHooks).toHaveBeenCalled()
      expect(() => ctx.registerTools([])).toThrow(/agentTools/)
    })
  })

  describe('tools+hooks manifest', () => {
    it('both work', () => {
      const host = makeHost()
      const ctx = buildContext({
        extensionId: 'rose-x',
        manifest: manifest({ main: true, agentTools: true, chatHooks: true }),
        host
      })
      ctx.registerTools([])
      ctx.registerHooks([])
      expect(host.registerTools).toHaveBeenCalled()
      expect(host.registerHooks).toHaveBeenCalled()
    })
  })

  describe('full manifest (every capability)', () => {
    it('every gated method is live', () => {
      const host = makeHost()
      const ctx = buildContext({
        extensionId: 'rose-everything',
        manifest: manifest({
          main: true,
          pageView: true,
          agentTools: true,
          chatHooks: true,
          agentSession: true,
          backgroundAgent: true,
          notifyStatus: true,
          broadcast: true
        }),
        host
      })
      ctx.broadcast('c', 1)
      ctx.notifyStatus('hi')
      ctx.registerTools([])
      ctx.registerHooks([])
      void ctx.runBackgroundAgent('p', 's')
      ctx.openAgentSession({ systemPrompt: 's' })
      expect(host.broadcast).toHaveBeenCalled()
      expect(host.notifyStatus).toHaveBeenCalled()
      expect(host.registerTools).toHaveBeenCalled()
      expect(host.registerHooks).toHaveBeenCalled()
      expect(host.runBackgroundAgent).toHaveBeenCalled()
      expect(host.openAgentSession).toHaveBeenCalled()
    })
  })

  describe('capability -> method mapping', () => {
    it('exposes the documented mapping', () => {
      expect(CAPABILITY_TO_METHOD).toEqual({
        agentTools: 'registerTools',
        chatHooks: 'registerHooks',
        backgroundAgent: 'runBackgroundAgent',
        detachedRunWithTools: 'runDetachedRunWithTools',
        agentSession: 'openAgentSession',
        notifyStatus: 'notifyStatus',
        broadcast: 'broadcast'
      })
    })
  })

  describe('listGrantedMethods', () => {
    it('lists only always-present for UI-only', () => {
      expect(listGrantedMethods(manifest({ pageView: true })).sort()).toEqual(
        ['getSettings', 'rootPath', 'updateSettings'].sort()
      )
    })

    it('lists granted gated methods', () => {
      const methods = listGrantedMethods(
        manifest({ main: true, chatHooks: true, broadcast: true })
      )
      expect(methods).toContain('registerHooks')
      expect(methods).toContain('broadcast')
      expect(methods).not.toContain('registerTools')
      expect(methods).not.toContain('runBackgroundAgent')
    })
  })
})
