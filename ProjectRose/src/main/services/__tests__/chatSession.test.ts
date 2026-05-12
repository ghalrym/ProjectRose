import { describe, it, expect } from 'vitest'
import { ChatSession } from '../chatSession'

describe('ChatSession.pendingAskUser', () => {
  it('starts with an empty pendingAskUser map', () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    expect(s.pendingAskUser.size).toBe(0)
  })

  it('resolves a pending ask-user by toolCallId and removes it from the map', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const answered = new Promise<string>((resolve) => {
      s.pendingAskUser.set('q1', resolve)
    })
    s.resolveAskUserQuestion('q1', 'Yes')
    await expect(answered).resolves.toBe('Yes')
    expect(s.pendingAskUser.has('q1')).toBe(false)
  })

  it('resolveAskUserQuestion for an unknown id is a no-op', () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    expect(() => s.resolveAskUserQuestion('nope', 'Yes')).not.toThrow()
    expect(s.pendingAskUser.size).toBe(0)
  })

  it('cancelPendingAskUser resolves every pending entry with "[cancelled]" and clears the map', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const a = new Promise<string>((resolve) => s.pendingAskUser.set('q1', resolve))
    const b = new Promise<string>((resolve) => s.pendingAskUser.set('q2', resolve))
    s.cancelPendingAskUser()
    await expect(a).resolves.toBe('[cancelled]')
    await expect(b).resolves.toBe('[cancelled]')
    expect(s.pendingAskUser.size).toBe(0)
  })

  it('cancel() aborts the controller and cancels pending ask-user promises', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const answered = new Promise<string>((resolve) => s.pendingAskUser.set('q1', resolve))
    s.cancel()
    expect(s.abortSignal.aborted).toBe(true)
    await expect(answered).resolves.toBe('[cancelled]')
  })

  it('dispose() resolves any in-flight ask-user with "[cancelled]"', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const answered = new Promise<string>((resolve) => s.pendingAskUser.set('q1', resolve))
    s.dispose()
    await expect(answered).resolves.toBe('[cancelled]')
    expect(s.pendingAskUser.size).toBe(0)
  })

  it('two parallel sessions do not see each other pending ask-user entries', async () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })

    const aAnswer = new Promise<string>((resolve) => a.pendingAskUser.set('q', resolve))
    const bAnswer = new Promise<string>((resolve) => b.pendingAskUser.set('q', resolve))

    a.resolveAskUserQuestion('q', 'from-a')

    await expect(aAnswer).resolves.toBe('from-a')
    expect(b.pendingAskUser.has('q')).toBe(true)

    b.resolveAskUserQuestion('q', 'from-b')
    await expect(bAnswer).resolves.toBe('from-b')
  })
})
