import { describe, it, expect } from 'vitest'
import { SpeechSessionRegistry } from '../sessionRegistry'
import type { SpeechSession } from '../session'

function fakeSession(sessionId: number): SpeechSession {
  return { sessionId } as unknown as SpeechSession
}

describe('SpeechSessionRegistry', () => {
  it('starts empty', () => {
    const r = new SpeechSessionRegistry()
    expect(r.size()).toBe(0)
    expect(r.get(1)).toBeUndefined()
  })

  it('adds a session and retrieves it by sessionId', () => {
    const r = new SpeechSessionRegistry()
    const s = fakeSession(7)
    r.add(s)
    expect(r.get(7)).toBe(s)
    expect(r.size()).toBe(1)
  })

  it('keeps multiple sessions distinct', () => {
    const r = new SpeechSessionRegistry()
    const a = fakeSession(1)
    const b = fakeSession(2)
    r.add(a)
    r.add(b)
    expect(r.get(1)).toBe(a)
    expect(r.get(2)).toBe(b)
    expect(r.size()).toBe(2)
  })

  it('remove deletes the session and lowers size', () => {
    const r = new SpeechSessionRegistry()
    r.add(fakeSession(7))
    r.remove(7)
    expect(r.get(7)).toBeUndefined()
    expect(r.size()).toBe(0)
  })

  it('remove of an unknown sessionId is a no-op', () => {
    const r = new SpeechSessionRegistry()
    r.add(fakeSession(7))
    expect(() => r.remove(99)).not.toThrow()
    expect(r.size()).toBe(1)
    expect(r.get(7)).toBeDefined()
  })

  it('add with the same sessionId replaces the prior entry', () => {
    const r = new SpeechSessionRegistry()
    const a = fakeSession(7)
    const b = fakeSession(7)
    r.add(a)
    r.add(b)
    expect(r.get(7)).toBe(b)
    expect(r.size()).toBe(1)
  })
})
