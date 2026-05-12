import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HookPipeline } from '../extensionHooks'
import type { ChatHook, ChatHookManifestEntry } from '../../../shared/extensionHooks'
import { MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE } from '../../../shared/extensionHooks'

const ROOT = '/proj'

function key(extId: string): string {
  return `${ROOT}/${extId}`
}

function info(id: string, name?: string): {
  extensionId: string
  extensionName: string
  extensionIcon?: string
  rootPath: string
} {
  return { extensionId: id, extensionName: name ?? id, rootPath: ROOT }
}

describe('HookPipeline', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  describe('empty pipeline', () => {
    it('returns null from injecting hooks when no extensions are registered', async () => {
      const p = new HookPipeline()
      const r = await p.fireThought('hi', 't1', ROOT)
      expect(r).toBeNull()
    })

    it('completes notifying dispatch without throwing when no extensions are registered', async () => {
      const p = new HookPipeline()
      await expect(p.fireUserMessage('hi', ROOT)).resolves.toBeUndefined()
      await expect(p.fireToken('x', 't1', ROOT)).resolves.toBeUndefined()
    })
  })

  describe('single notifying hook', () => {
    it('fires the registered handler with the event', async () => {
      const p = new HookPipeline()
      const handler = vi.fn()
      const hooks: ChatHook[] = [{ type: 'on_user_message', handler }]
      p.register(key('ext'), info('ext'), hooks)
      await p.fireUserMessage('hello', ROOT)
      expect(handler).toHaveBeenCalledOnce()
      expect(handler.mock.calls[0][0]).toMatchObject({ type: 'on_user_message', content: 'hello' })
    })

    it('continues dispatch when a handler throws', async () => {
      const p = new HookPipeline()
      const bad: ChatHook = {
        type: 'on_user_message',
        handler: () => {
          throw new Error('boom')
        }
      }
      const good = vi.fn()
      p.register(key('a'), info('a'), [bad])
      p.register(key('b'), info('b'), [{ type: 'on_user_message', handler: good }])
      await p.fireUserMessage('x', ROOT)
      expect(good).toHaveBeenCalledOnce()
    })
  })

  describe('injecting hooks — first-wins (default)', () => {
    it('returns the first injecting hook and stops the rest', async () => {
      const p = new HookPipeline()
      const a = vi.fn(async () => ({ inject: 'A' }))
      const b = vi.fn(async () => ({ inject: 'B' }))
      p.register(key('a'), info('a', 'A'), [{ type: 'on_message', handler: a }])
      p.register(key('b'), info('b', 'B'), [{ type: 'on_message', handler: b }])
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r?.content).toBe('A')
      expect(r?.extensionId).toBe('a')
      expect(a).toHaveBeenCalledOnce()
      expect(b).not.toHaveBeenCalled()
    })

    it('skips a hook that returns no inject and lets the next inject', async () => {
      const p = new HookPipeline()
      const a = vi.fn(async () => undefined)
      const b = vi.fn(async () => ({ inject: 'B' }))
      p.register(key('a'), info('a'), [{ type: 'on_message', handler: a }])
      p.register(key('b'), info('b'), [{ type: 'on_message', handler: b }])
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r?.content).toBe('B')
      expect(a).toHaveBeenCalledOnce()
      expect(b).toHaveBeenCalledOnce()
    })

    it('respects priority — lower fires first', async () => {
      const p = new HookPipeline()
      const high = vi.fn(async () => ({ inject: 'HIGH' })) // priority 200
      const low = vi.fn(async () => ({ inject: 'LOW' })) // priority 10
      // Register the "high" extension first to verify priority overrides registration order
      p.register(key('high'), info('high'), [{ type: 'on_message', handler: high, priority: 200 }])
      p.register(key('low'), info('low'), [{ type: 'on_message', handler: low, priority: 10 }])
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r?.content).toBe('LOW')
      expect(low).toHaveBeenCalledOnce()
      expect(high).not.toHaveBeenCalled()
    })
  })

  describe('injecting hooks — "all" policy', () => {
    it('collects every injection from extensions whose manifest declared all', async () => {
      const p = new HookPipeline()
      const a = vi.fn(async () => ({ inject: 'A' }))
      const b = vi.fn(async () => ({ inject: 'B' }))
      const manifestHooks: ChatHookManifestEntry[] = [{ type: 'on_message', injectionPolicy: 'all' }]
      p.register(key('a'), info('a'), [{ type: 'on_message', handler: a }], manifestHooks)
      p.register(key('b'), info('b'), [{ type: 'on_message', handler: b }], manifestHooks)
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r?.content).toBe('A\n\nB')
      // Provenance points at the first injecting extension
      expect(r?.extensionId).toBe('a')
      expect(a).toHaveBeenCalledOnce()
      expect(b).toHaveBeenCalledOnce()
    })

    it('lets a first-wins extension cap the dispatch even when later all-policy extensions exist', async () => {
      // Reading: the FIRST extension reached (sorted by priority + registration)
      // determines whether subsequent extensions get a chance only if it is
      // first-wins AND it injected. An "all" extension never sets the cap;
      // a first-wins extension that injected does.
      const p = new HookPipeline()
      const fw = vi.fn(async () => ({ inject: 'FW' }))
      const after = vi.fn(async () => ({ inject: 'AFTER' }))
      p.register(key('fw'), info('fw'), [{ type: 'on_message', handler: fw, priority: 10 }])
      p.register(
        key('after'),
        info('after'),
        [{ type: 'on_message', handler: after, priority: 20 }],
        [{ type: 'on_message', injectionPolicy: 'all' }]
      )
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r?.content).toBe('FW')
      expect(after).not.toHaveBeenCalled()
    })
  })

  describe('per-extension turn budget', () => {
    it('honors single-injection cap by default', async () => {
      const p = new HookPipeline()
      const handler = vi.fn(async () => ({ inject: 'I' }))
      p.register(
        key('a'),
        info('a'),
        [{ type: 'on_message', handler }],
        [{ type: 'on_message', injectionPolicy: 'all' }]
      )
      // First call injects, second call should be rejected by budget
      await p.fireMessage('m1', 't', ROOT)
      const r2 = await p.fireMessage('m2', 't', ROOT)
      expect(r2).toBeNull()
      expect(handler).toHaveBeenCalledOnce()
    })

    it('honors MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE when allowMultiple: true', async () => {
      const p = new HookPipeline()
      const handler = vi.fn(async () => ({ inject: 'I' }))
      p.register(
        key('a'),
        info('a'),
        [{ type: 'on_message', handler, allowMultiple: true }],
        [{ type: 'on_message', injectionPolicy: 'all' }]
      )
      for (let i = 0; i < MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE; i++) {
        const r = await p.fireMessage(`m${i}`, 't', ROOT)
        expect(r?.content).toBe('I')
      }
      const over = await p.fireMessage('overflow', 't', ROOT)
      expect(over).toBeNull()
      expect(handler).toHaveBeenCalledTimes(MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE)
    })

    it('resetTurnBudgets clears the per-extension counter', async () => {
      const p = new HookPipeline()
      const handler = vi.fn(async () => ({ inject: 'I' }))
      p.register(key('a'), info('a'), [{ type: 'on_message', handler }])
      await p.fireMessage('m1', 't', ROOT)
      expect(await p.fireMessage('m2', 't', ROOT)).toBeNull()
      p.resetTurnBudgets()
      const r = await p.fireMessage('m3', 't', ROOT)
      expect(r?.content).toBe('I')
    })
  })

  describe('handler that throws inside injecting dispatch', () => {
    it('logs and continues to the next hook', async () => {
      const p = new HookPipeline()
      const bad = vi.fn(async () => {
        throw new Error('boom')
      })
      const good = vi.fn(async () => ({ inject: 'GOOD' }))
      p.register(key('a'), info('a'), [{ type: 'on_message', handler: bad, priority: 10 }])
      p.register(key('b'), info('b'), [{ type: 'on_message', handler: good, priority: 20 }])
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r?.content).toBe('GOOD')
      expect(errorSpy).toHaveBeenCalled()
    })
  })

  describe('rootPath filtering', () => {
    it('only fires hooks registered for the matching rootPath', async () => {
      const p = new HookPipeline()
      const a = vi.fn(async () => ({ inject: 'A' }))
      p.register('/other/a', { ...info('a'), rootPath: '/other' }, [{ type: 'on_message', handler: a }])
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r).toBeNull()
      expect(a).not.toHaveBeenCalled()
    })
  })

  describe('drift detection', () => {
    it('reports declared-but-not-registered hook types', () => {
      const p = new HookPipeline()
      p.register(
        key('a'),
        info('a'),
        [{ type: 'on_message', handler: () => {} }],
        [
          { type: 'on_message' },
          { type: 'on_thought' }
        ]
      )
      const missing = p.declaredButNotRegistered(key('a'), ['on_message', 'on_thought'])
      expect(missing).toEqual(['on_thought'])
    })

    it('reports registered-but-not-declared hook types', () => {
      const p = new HookPipeline()
      p.register(
        key('a'),
        info('a'),
        [
          { type: 'on_message', handler: () => {} },
          { type: 'on_thought', handler: () => {} }
        ],
        [{ type: 'on_message' }]
      )
      const undeclared = p.registeredButNotDeclared(key('a'), ['on_message'])
      expect(undeclared).toEqual(['on_thought'])
    })
  })

  describe('unregister', () => {
    it('removes the extension from subsequent dispatches', async () => {
      const p = new HookPipeline()
      const handler = vi.fn(async () => ({ inject: 'I' }))
      p.register(key('a'), info('a'), [{ type: 'on_message', handler }])
      p.unregister(key('a'))
      const r = await p.fireMessage('m', 't', ROOT)
      expect(r).toBeNull()
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
