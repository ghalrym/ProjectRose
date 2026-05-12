import { describe, it, expect } from 'vitest'
import { ChatSession, type ScreenshotResult } from '../chatSession'

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

describe('ChatSession.pendingScreenshots', () => {
  const okResult: ScreenshotResult = {
    ok: true,
    dataUrl: 'data:image/jpeg;base64,xx',
    mode: 'screen',
    sourceLabel: 'Display 1',
  }

  it('starts with an empty pendingScreenshots map', () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    expect(s.pendingScreenshots.size).toBe(0)
  })

  it('resolves a pending screenshot by toolCallId and removes it from the map', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const result = new Promise<ScreenshotResult>((resolve) => {
      s.pendingScreenshots.set('r1', resolve)
    })
    s.resolveScreenshot('r1', okResult)
    await expect(result).resolves.toEqual(okResult)
    expect(s.pendingScreenshots.has('r1')).toBe(false)
  })

  it('resolveScreenshot for an unknown id is a no-op', () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    expect(() => s.resolveScreenshot('nope', okResult)).not.toThrow()
    expect(s.pendingScreenshots.size).toBe(0)
  })

  it('cancelPendingScreenshots resolves every pending entry with the cancelled sentinel', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const a = new Promise<ScreenshotResult>((resolve) => s.pendingScreenshots.set('r1', resolve))
    const b = new Promise<ScreenshotResult>((resolve) => s.pendingScreenshots.set('r2', resolve))
    s.cancelPendingScreenshots()
    await expect(a).resolves.toEqual({ ok: false, reason: 'cancelled' })
    await expect(b).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(s.pendingScreenshots.size).toBe(0)
  })

  it('cancel() cancels pending screenshots — closes the prior leak', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const result = new Promise<ScreenshotResult>((resolve) => s.pendingScreenshots.set('r1', resolve))
    s.cancel()
    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })

  it('dispose() cancels any in-flight screenshot promise', async () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const result = new Promise<ScreenshotResult>((resolve) => s.pendingScreenshots.set('r1', resolve))
    s.dispose()
    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(s.pendingScreenshots.size).toBe(0)
  })

  it('two parallel sessions do not see each other pending screenshot entries', async () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })

    const aResult = new Promise<ScreenshotResult>((resolve) => a.pendingScreenshots.set('r', resolve))
    const bResult = new Promise<ScreenshotResult>((resolve) => b.pendingScreenshots.set('r', resolve))

    a.resolveScreenshot('r', okResult)
    await expect(aResult).resolves.toEqual(okResult)
    expect(b.pendingScreenshots.has('r')).toBe(true)

    b.resolveScreenshot('r', { ok: false, reason: 'b-failed' })
    await expect(bResult).resolves.toEqual({ ok: false, reason: 'b-failed' })
  })
})

describe('ChatSession.modifiedFiles', () => {
  it('starts as an empty array', () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    expect(s.modifiedFiles).toEqual([])
  })

  it('two parallel sessions track modified files independently', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })

    a.modifiedFiles.push('/proj/a.ts')
    b.modifiedFiles.push('/proj/b.ts')

    expect(a.modifiedFiles).toEqual(['/proj/a.ts'])
    expect(b.modifiedFiles).toEqual(['/proj/b.ts'])
  })

  it('a disposed session leaves the other session\'s array untouched', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })

    a.modifiedFiles.push('/proj/a.ts')
    b.modifiedFiles.push('/proj/b.ts')

    a.dispose()
    expect(b.modifiedFiles).toEqual(['/proj/b.ts'])
  })
})

describe('ChatSession.turnBudget', () => {
  it('starts as an empty map — a new session always sees an empty budget', () => {
    const s = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    expect(s.turnBudget.size).toBe(0)
  })

  it('two parallel sessions track per-extension budgets independently', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })

    a.turnBudget.set('ext.one', 1)
    expect(a.turnBudget.get('ext.one')).toBe(1)
    expect(b.turnBudget.get('ext.one')).toBeUndefined()
  })

  it('a new session has an empty budget regardless of what a prior session consumed', () => {
    const prior = new ChatSession({ sessionId: 'prior', rootPath: '/proj' })
    prior.turnBudget.set('ext.one', 1)
    prior.turnBudget.set('ext.two', 3)
    prior.dispose()

    const next = new ChatSession({ sessionId: 'next', rootPath: '/proj' })
    expect(next.turnBudget.size).toBe(0)
  })
})
