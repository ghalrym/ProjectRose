import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearInteractionLog,
  logInteraction,
  readRecentInteractions
} from '../interactionLog'
import { INTERACTION_LOG_CAPACITY } from '../../../shared/interactionLog'

describe('interactionLog', () => {
  beforeEach(() => {
    clearInteractionLog()
  })

  it('appends entries with kind and optional target', () => {
    logInteraction('view.changed', 'settings')
    logInteraction('chat.message-sent')
    const recent = readRecentInteractions()
    expect(recent).toHaveLength(2)
    expect(recent[0]).toMatchObject({ kind: 'view.changed', target: 'settings' })
    expect(recent[1]).toMatchObject({ kind: 'chat.message-sent' })
    expect(recent[1].target).toBeUndefined()
    expect(typeof recent[0].timestamp).toBe('number')
  })

  it('returns entries newest-last (transcript order)', () => {
    logInteraction('a')
    logInteraction('b')
    logInteraction('c')
    const recent = readRecentInteractions()
    expect(recent.map((e) => e.kind)).toEqual(['a', 'b', 'c'])
  })

  it('caps the ring at INTERACTION_LOG_CAPACITY and drops the oldest', () => {
    for (let i = 0; i < INTERACTION_LOG_CAPACITY + 10; i++) {
      logInteraction(`k-${i}`)
    }
    const recent = readRecentInteractions()
    expect(recent).toHaveLength(INTERACTION_LOG_CAPACITY)
    expect(recent[0].kind).toBe('k-10')
    expect(recent[recent.length - 1].kind).toBe(`k-${INTERACTION_LOG_CAPACITY + 9}`)
  })

  it('honors limit when smaller than the ring', () => {
    for (let i = 0; i < 20; i++) logInteraction(`k-${i}`)
    const recent = readRecentInteractions(5)
    expect(recent).toHaveLength(5)
    expect(recent.map((e) => e.kind)).toEqual(['k-15', 'k-16', 'k-17', 'k-18', 'k-19'])
  })

  it('returns a copy so callers cannot mutate the ring', () => {
    logInteraction('a')
    const recent = readRecentInteractions()
    recent.push({ timestamp: 0, kind: 'tampered' })
    expect(readRecentInteractions()).toHaveLength(1)
  })

  it('ignores empty kind', () => {
    logInteraction('')
    expect(readRecentInteractions()).toHaveLength(0)
  })
})
