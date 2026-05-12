import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSessionsStore } from '../useSessionsStore'
import type { SessionMeta } from '../../types/chatMessages'

function meta(id: string, title: string, createdAt = 0, updatedAt = 0): SessionMeta {
  return { id, title, createdAt, updatedAt }
}

describe('useSessionsStore', () => {
  beforeEach(() => {
    useSessionsStore.setState({ sessions: [], currentSessionId: null })
  })

  it('setSessions replaces the full list', () => {
    useSessionsStore.getState().setSessions([meta('a', 'A'), meta('b', 'B')])
    expect(useSessionsStore.getState().sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('setCurrentSessionId records the id', () => {
    useSessionsStore.getState().setCurrentSessionId('s1')
    expect(useSessionsStore.getState().currentSessionId).toBe('s1')
  })

  it('upsertSession prepends a new session', () => {
    useSessionsStore.getState().setSessions([meta('a', 'A')])
    useSessionsStore.getState().upsertSession(meta('b', 'B'))
    expect(useSessionsStore.getState().sessions.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('upsertSession replaces an existing session in place', () => {
    useSessionsStore.getState().setSessions([meta('a', 'A'), meta('b', 'B')])
    useSessionsStore.getState().upsertSession(meta('a', 'A-updated', 1, 99))
    const s = useSessionsStore.getState().sessions
    expect(s.map((x) => x.id)).toEqual(['a', 'b'])
    expect(s[0]).toMatchObject({ title: 'A-updated', updatedAt: 99 })
  })

  it('removeSession drops the matching id', () => {
    useSessionsStore.getState().setSessions([meta('a', 'A'), meta('b', 'B')])
    useSessionsStore.getState().removeSession('a')
    expect(useSessionsStore.getState().sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('renameSessionLocal updates only the title', () => {
    useSessionsStore.getState().setSessions([meta('a', 'A', 1, 1)])
    useSessionsStore.getState().renameSessionLocal('a', 'new title')
    const s = useSessionsStore.getState().sessions[0]
    expect(s.title).toBe('new title')
    expect(s.createdAt).toBe(1)
    expect(s.updatedAt).toBe(1)
  })

  describe('touchSession', () => {
    afterEach(() => vi.useRealTimers())

    it('bumps updatedAt to Date.now() for the matching id', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
      useSessionsStore.getState().setSessions([meta('a', 'A', 100, 100), meta('b', 'B', 100, 100)])
      useSessionsStore.getState().touchSession('a')
      const sessions = useSessionsStore.getState().sessions
      expect(sessions[0].updatedAt).toBe(new Date('2025-01-01T00:00:00Z').getTime())
      expect(sessions[1].updatedAt).toBe(100)
    })

    it('is a no-op when id is unknown', () => {
      useSessionsStore.getState().setSessions([meta('a', 'A', 1, 1)])
      const before = useSessionsStore.getState().sessions
      useSessionsStore.getState().touchSession('unknown')
      expect(useSessionsStore.getState().sessions[0]).toEqual(before[0])
    })
  })
})
