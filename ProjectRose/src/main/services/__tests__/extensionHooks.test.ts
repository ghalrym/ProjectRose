import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HookPipeline, registerHooks, unregisterHooks, fireMessageHook } from '../extensionHooks'
import { ChatSession } from '../chatSession'
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

function makeSession(rootPath: string = ROOT): ChatSession {
  return new ChatSession({ sessionId: `s-${Math.random().toString(36).slice(2)}`, rootPath })
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
      const r = await p.fireThought('hi', 't1', ROOT, makeSession())
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
      expect(r?.content).toBe('FW')
      expect(after).not.toHaveBeenCalled()
    })
  })

  describe('per-session turn budget', () => {
    it('honors single-injection cap by default within a single session', async () => {
      const p = new HookPipeline()
      const handler = vi.fn(async () => ({ inject: 'I' }))
      p.register(
        key('a'),
        info('a'),
        [{ type: 'on_message', handler }],
        [{ type: 'on_message', injectionPolicy: 'all' }]
      )
      const session = makeSession()
      // First call injects, second call should be rejected by the session's budget
      await p.fireMessage('m1', 't', ROOT, session)
      const r2 = await p.fireMessage('m2', 't', ROOT, session)
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
      const session = makeSession()
      for (let i = 0; i < MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE; i++) {
        const r = await p.fireMessage(`m${i}`, 't', ROOT, session)
        expect(r?.content).toBe('I')
      }
      const over = await p.fireMessage('overflow', 't', ROOT, session)
      expect(over).toBeNull()
      expect(handler).toHaveBeenCalledTimes(MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE)
    })

    it('a fresh session starts with an empty budget — exhausting one session does not block another', async () => {
      // Budget reset is implicit in session lifecycle: a new ChatSession means
      // a new empty `turnBudget`. There is no `resetTurnBudgets` call.
      const p = new HookPipeline()
      const handler = vi.fn(async () => ({ inject: 'I' }))
      p.register(key('a'), info('a'), [{ type: 'on_message', handler }])
      const first = makeSession()
      await p.fireMessage('m1', 't', ROOT, first)
      expect(await p.fireMessage('m2', 't', ROOT, first)).toBeNull()
      const next = makeSession()
      const r = await p.fireMessage('m3', 't', ROOT, next)
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
      expect(r?.content).toBe('GOOD')
      expect(errorSpy).toHaveBeenCalled()
    })
  })

  describe('rootPath filtering', () => {
    it('only fires hooks registered for the matching rootPath', async () => {
      const p = new HookPipeline()
      const a = vi.fn(async () => ({ inject: 'A' }))
      p.register('/other/a', { ...info('a'), rootPath: '/other' }, [{ type: 'on_message', handler: a }])
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
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
      const r = await p.fireMessage('m', 't', ROOT, makeSession())
      expect(r).toBeNull()
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// These tests exercise the module-level wrappers against the singleton
// pipeline. They cover the turnBudget seam: budgets live on the session, so
// parallel sessions firing the same hooks see independent counters.

const TEST_KEY = 'test-root/test-ext'
const TEST_ROOT = 'test-root'

describe('extensionHooks turnBudget on ChatSession', () => {
  beforeEach(() => {
    registerHooks(
      TEST_KEY,
      { extensionId: 'test-ext', extensionName: 'Test', rootPath: TEST_ROOT },
      [
        {
          type: 'on_message',
          handler: () => ({ inject: 'injected once' }),
        },
      ]
    )
  })

  afterEach(() => {
    unregisterHooks(TEST_KEY)
  })

  it('once an injection has fired for an extension, further on_message events in the same session do not re-inject', async () => {
    const session = new ChatSession({ sessionId: 's1', rootPath: TEST_ROOT })

    const first = await fireMessageHook('hi', 'turn-1', TEST_ROOT, session)
    const second = await fireMessageHook('hi again', 'turn-1', TEST_ROOT, session)

    expect(first?.content).toBe('injected once')
    expect(second).toBeNull()
    expect(session.turnBudget.get('test-ext')).toBe(1)
  })

  it('parallel sessions have independent budgets — each injects once', async () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: TEST_ROOT })
    const b = new ChatSession({ sessionId: 'b', rootPath: TEST_ROOT })

    const aFirst = await fireMessageHook('hi', 'turn-a', TEST_ROOT, a)
    const bFirst = await fireMessageHook('hi', 'turn-b', TEST_ROOT, b)
    const aSecond = await fireMessageHook('again', 'turn-a', TEST_ROOT, a)

    expect(aFirst?.content).toBe('injected once')
    expect(bFirst?.content).toBe('injected once')
    expect(aSecond).toBeNull()

    expect(a.turnBudget.get('test-ext')).toBe(1)
    expect(b.turnBudget.get('test-ext')).toBe(1)
  })

  it('a fresh session after another session exhausted its budget still gets one injection', async () => {
    const first = new ChatSession({ sessionId: 'first', rootPath: TEST_ROOT })
    await fireMessageHook('msg', 'turn-1', TEST_ROOT, first)
    expect(first.turnBudget.get('test-ext')).toBe(1)

    const next = new ChatSession({ sessionId: 'next', rootPath: TEST_ROOT })
    const result = await fireMessageHook('msg', 'turn-2', TEST_ROOT, next)
    expect(result?.content).toBe('injected once')
  })
})
