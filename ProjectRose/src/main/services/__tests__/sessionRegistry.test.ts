import { describe, it, expect, afterEach } from 'vitest'
import { ChatSession } from '../chatSession'
import { sessionRegistry } from '../sessionRegistry'

describe('sessionRegistry', () => {
  // Track ids the test registered so they can be unregistered after each
  // test even if the assertion path threw before the unregister call.
  const registered: string[] = []
  const trackedRegister = (s: ChatSession): void => {
    sessionRegistry.register(s)
    registered.push(s.sessionId)
  }

  afterEach(() => {
    for (const id of registered) sessionRegistry.unregister(id)
    registered.length = 0
  })

  it('register/get round-trips a session by sessionId', () => {
    const s = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    trackedRegister(s)
    expect(sessionRegistry.get('a')).toBe(s)
  })

  it('returns undefined for an unknown sessionId — IPC routing no-ops', () => {
    expect(sessionRegistry.get('nope')).toBeUndefined()
    // The IPC handler shape is `registry.get(id)?.resolveAskUserQuestion(...)`;
    // verify that pattern is safe.
    expect(() =>
      sessionRegistry.get('nope')?.resolveAskUserQuestion('q', 'a')
    ).not.toThrow()
  })

  it('unregister removes the session', () => {
    const s = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    trackedRegister(s)
    sessionRegistry.unregister('a')
    expect(sessionRegistry.get('a')).toBeUndefined()
  })

  it('AI_CANCEL routed at an unknown sessionId does not cancel any registered session', () => {
    // Two registered sessions stand in for "two concurrent chats". An
    // AI_CANCEL payload arrives with a sessionId that belongs to neither.
    // The handler shape `registry.get(unknownId)?.cancel()` must not abort
    // either registered session.
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    trackedRegister(a)
    trackedRegister(b)

    sessionRegistry.get('does-not-exist')?.cancel()

    expect(a.abortSignal.aborted).toBe(false)
    expect(b.abortSignal.aborted).toBe(false)
  })

  it('AI_CANCEL routed at a known sessionId cancels only that session', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    trackedRegister(a)
    trackedRegister(b)

    sessionRegistry.get('a')?.cancel()

    expect(a.abortSignal.aborted).toBe(true)
    expect(b.abortSignal.aborted).toBe(false)
  })
})
