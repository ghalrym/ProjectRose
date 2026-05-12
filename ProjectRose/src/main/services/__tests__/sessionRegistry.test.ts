import { describe, it, expect, beforeEach } from 'vitest'
import { ChatSession } from '../chatSession'
import { sessionRegistry } from '../sessionRegistry'

describe('sessionRegistry', () => {
  beforeEach(() => {
    // Process-level singleton — clear any stragglers between tests.
    for (let s = sessionRegistry.getActive(); s; s = sessionRegistry.getActive()) {
      sessionRegistry.unregister(s.sessionId)
    }
  })

  it('register/get round-trips a session by sessionId', () => {
    const s = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    sessionRegistry.register(s)
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
    sessionRegistry.register(s)
    sessionRegistry.unregister('a')
    expect(sessionRegistry.get('a')).toBeUndefined()
  })

  it('getActive returns the most recently registered session', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    sessionRegistry.register(a)
    sessionRegistry.register(b)
    expect(sessionRegistry.getActive()).toBe(b)
  })
})
