import { describe, it, expect, vi } from 'vitest'
import {
  openSpeechSession,
  sendSpeechChunk,
  closeSpeechSession
} from '../sessionLifecycle'
import { SpeechSession } from '../session'
import { SpeechSessionRegistry } from '../sessionRegistry'
import type { TranscriptionWorkerHandle, TranscriptionResult } from '../transcriptionWorkerHandle'

function fakeWorker(results: TranscriptionResult[]): TranscriptionWorkerHandle {
  const queue = [...results]
  return {
    warmup: () => {},
    process: async () => queue.shift() ?? { text: null, embedding: null }
  } as unknown as TranscriptionWorkerHandle
}

function fakeSession(sessionId: number, projectPath: string, worker: TranscriptionWorkerHandle): SpeechSession {
  return new SpeechSession(
    { sessionId, projectPath },
    {
      worker,
      db: {
        addRecording: () => ({ id: 1 }),
        createUtterance: () => ({ id: sessionId * 100 + Math.floor(Math.random() * 100) }),
        getSpeakers: () => []
      },
      identifier: () => ({ speakerId: null, confidence: 0 }),
      saveRecording: () => '/x',
      whisperModel: async () => 'Xenova/whisper-tiny.en',
      emit: () => {}
    }
  )
}

describe('Speech session IPC seam', () => {
  it('open -> send three chunks -> close drains and clears the registry', async () => {
    const registry = new SpeechSessionRegistry()
    const worker = fakeWorker([
      { text: 'one', embedding: null },
      { text: 'two', embedding: null },
      { text: 'three', embedding: null }
    ])
    const utterances: string[] = []

    const { sessionId } = openSpeechSession(
      registry,
      { projectPath: '/p' },
      {
        createSession: () => ({ id: 99 }),
        makeSession: (id, projectPath) => {
          const s = fakeSession(id, projectPath, worker)
          s.onUtterance((evt) => utterances.push(evt.text))
          return s
        }
      }
    )

    expect(sessionId).toBe(99)
    expect(registry.size()).toBe(1)

    sendSpeechChunk(registry, { sessionId, audioBuffer: new ArrayBuffer(4) })
    sendSpeechChunk(registry, { sessionId, audioBuffer: new ArrayBuffer(4) })
    sendSpeechChunk(registry, { sessionId, audioBuffer: new ArrayBuffer(4) })

    const endSession = vi.fn(() => ({ ok: true }))
    await closeSpeechSession(
      registry,
      { sessionId, projectPath: '/p' },
      { endSession }
    )

    expect(utterances).toEqual(['one', 'two', 'three'])
    expect(registry.size()).toBe(0)
    expect(endSession).toHaveBeenCalledWith('/p', 99)
  })

  it('closeSession is idempotent and still writes ended_at when called twice', async () => {
    const registry = new SpeechSessionRegistry()
    const endSession = vi.fn(() => ({ ok: true }))

    const { sessionId } = openSpeechSession(
      registry,
      { projectPath: '/p' },
      {
        createSession: () => ({ id: 7 }),
        makeSession: (id, projectPath) => fakeSession(id, projectPath, fakeWorker([]))
      }
    )

    await closeSpeechSession(registry, { sessionId, projectPath: '/p' }, { endSession })
    await closeSpeechSession(registry, { sessionId, projectPath: '/p' }, { endSession })

    expect(registry.size()).toBe(0)
    expect(endSession).toHaveBeenCalledTimes(2)
  })

  it('sendChunk to an unknown sessionId is a silent no-op', () => {
    const registry = new SpeechSessionRegistry()
    // Should not throw.
    sendSpeechChunk(registry, { sessionId: 12345, audioBuffer: new ArrayBuffer(4) })
    expect(registry.size()).toBe(0)
  })
})
