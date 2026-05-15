import { describe, it, expect } from 'vitest'
import { ChatSession, type ScreenshotResult } from '../chatSession'
import { sessionRegistry } from '../sessionRegistry'

/**
 * PRD `chat-turn-unification` issue #11 — multi-session concurrency smoke
 * test. The PRD's goal of removing module-level singletons
 * (`activeAbortController`, `pendingAskUser`, `pendingScreenshots`,
 * `modifiedFiles`) is only true if two concurrent sessions stay isolated.
 * Each assertion below corresponds to one of the four globals; reintroducing
 * any of them as a process-level state would cause one of these to fail.
 */
describe('multi-session concurrency', () => {
  it('answering session A\'s ask-user does not resolve session B\'s', async () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    sessionRegistry.register(a)
    sessionRegistry.register(b)

    try {
      const aQuestion = new Promise<string>((resolve) =>
        a.pendingAskUser.set('q1', resolve)
      )
      const bQuestion = new Promise<string>((resolve) =>
        b.pendingAskUser.set('q1', resolve)
      )

      // The IPC handler shape is sessionRegistry.get(id)?.resolveAskUserQuestion(...)
      // — drive both sides through that to mirror production.
      sessionRegistry.get('a')?.resolveAskUserQuestion('q1', 'A-answer')

      await expect(aQuestion).resolves.toBe('A-answer')
      expect(b.pendingAskUser.has('q1')).toBe(true)

      sessionRegistry.get('b')?.resolveAskUserQuestion('q1', 'B-answer')
      await expect(bQuestion).resolves.toBe('B-answer')
    } finally {
      sessionRegistry.unregister('a')
      sessionRegistry.unregister('b')
    }
  })

  it('cancelling session A does not cancel session B', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    sessionRegistry.register(a)
    sessionRegistry.register(b)

    try {
      sessionRegistry.get('a')?.cancel()
      expect(a.abortSignal.aborted).toBe(true)
      // If the abort controller were a module-level singleton, b would also
      // be aborted here.
      expect(b.abortSignal.aborted).toBe(false)
    } finally {
      sessionRegistry.unregister('a')
      sessionRegistry.unregister('b')
    }
  })

  it('screenshot results route by session id', async () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    sessionRegistry.register(a)
    sessionRegistry.register(b)

    try {
      const okA: ScreenshotResult = {
        ok: true,
        dataUrl: 'data:image/jpeg;base64,A',
        mode: 'screen',
        sourceLabel: 'screen-a',
      }
      const okB: ScreenshotResult = {
        ok: true,
        dataUrl: 'data:image/jpeg;base64,B',
        mode: 'webcam',
        sourceLabel: 'cam-b',
      }
      const aPromise = new Promise<ScreenshotResult>((resolve) =>
        a.pendingScreenshots.set('r1', resolve)
      )
      const bPromise = new Promise<ScreenshotResult>((resolve) =>
        b.pendingScreenshots.set('r1', resolve)
      )

      sessionRegistry.get('a')?.resolveScreenshot('r1', okA)
      sessionRegistry.get('b')?.resolveScreenshot('r1', okB)

      await expect(aPromise).resolves.toEqual(okA)
      await expect(bPromise).resolves.toEqual(okB)
    } finally {
      sessionRegistry.unregister('a')
      sessionRegistry.unregister('b')
    }
  })

  it('modifiedFiles is per-session: files written by B never appear on A', () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj' })
    sessionRegistry.register(a)
    sessionRegistry.register(b)

    try {
      // Tool handlers push into session.modifiedFiles via
      // sessionRegistry.get(toolCtx.sessionId)?.modifiedFiles.push(path).
      sessionRegistry.get('a')?.modifiedFiles.push('/proj/a.ts')
      sessionRegistry.get('b')?.modifiedFiles.push('/proj/b.ts')
      sessionRegistry.get('b')?.modifiedFiles.push('/proj/b2.ts')

      expect(a.modifiedFiles).toEqual(['/proj/a.ts'])
      expect(b.modifiedFiles).toEqual(['/proj/b.ts', '/proj/b2.ts'])
    } finally {
      sessionRegistry.unregister('a')
      sessionRegistry.unregister('b')
    }
  })

  it('two sessions run concurrently with Promise.all stay isolated end-to-end', async () => {
    const a = new ChatSession({ sessionId: 'a', rootPath: '/proj', role: 'main' })
    const b = new ChatSession({ sessionId: 'b', rootPath: '/proj', role: 'subagent' })
    sessionRegistry.register(a)
    sessionRegistry.register(b)

    try {
      // Simulate the two sessions concurrently asking and resolving
      // ask-user questions and recording modified files.
      const aWork = async (): Promise<{ answer: string; files: string[] }> => {
        const ans = new Promise<string>((resolve) =>
          a.pendingAskUser.set('q1', resolve)
        )
        // External resolver — simulates the IPC handler.
        queueMicrotask(() => {
          sessionRegistry.get('a')?.resolveAskUserQuestion('q1', 'A-answer')
          sessionRegistry.get('a')?.modifiedFiles.push('/proj/a1.ts')
        })
        const answer = await ans
        return { answer, files: [...a.modifiedFiles] }
      }

      const bWork = async (): Promise<{ answer: string; files: string[] }> => {
        const ans = new Promise<string>((resolve) =>
          b.pendingAskUser.set('q1', resolve)
        )
        queueMicrotask(() => {
          sessionRegistry.get('b')?.resolveAskUserQuestion('q1', 'B-answer')
          sessionRegistry.get('b')?.modifiedFiles.push('/proj/b1.ts')
        })
        const answer = await ans
        return { answer, files: [...b.modifiedFiles] }
      }

      const [aResult, bResult] = await Promise.all([aWork(), bWork()])

      expect(aResult.answer).toBe('A-answer')
      expect(bResult.answer).toBe('B-answer')
      expect(aResult.files).toEqual(['/proj/a1.ts'])
      expect(bResult.files).toEqual(['/proj/b1.ts'])
    } finally {
      sessionRegistry.unregister('a')
      sessionRegistry.unregister('b')
    }
  })
})
