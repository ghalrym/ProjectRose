import { describe, it, expect, vi } from 'vitest'
import { SpeechSession, type SpeechDB, type SpeakerIdentifier } from '../session'
import type { TranscriptionWorkerHandle, TranscriptionResult } from '../transcriptionWorkerHandle'

/**
 * Fake worker that returns canned TranscriptionResults in order. One result
 * is dequeued per process() call.
 */
function fakeWorker(results: TranscriptionResult[]): TranscriptionWorkerHandle {
  const queue = [...results]
  return {
    warmup: () => {},
    process: async (_buf: ArrayBuffer, _model: string) => {
      const next = queue.shift()
      if (!next) throw new Error('fakeWorker: no more results queued')
      return next
    }
  } as unknown as TranscriptionWorkerHandle
}

const fakeWhisperModel = async (): Promise<string> => 'Xenova/whisper-tiny.en'

/**
 * In-memory SpeechDB stand-in. Records all inserts so tests can assert on
 * them; returns sequential ids.
 */
function fakeDb(): SpeechDB & {
  recordings: Array<{ projectPath: string; speakerId: number | null; audioPath: string; source: string }>
  utterances: Array<{ projectPath: string; sessionId: number; recordingId: number | null; speakerId: number | null; text: string }>
} {
  const recordings: Array<{ projectPath: string; speakerId: number | null; audioPath: string; source: string }> = []
  const utterances: Array<{ projectPath: string; sessionId: number; recordingId: number | null; speakerId: number | null; text: string }> = []
  return {
    recordings,
    utterances,
    addRecording: (projectPath, speakerId, audioPath, source) => {
      recordings.push({ projectPath, speakerId, audioPath, source })
      return { id: recordings.length }
    },
    createUtterance: (projectPath, sessionId, recordingId, speakerId, text) => {
      utterances.push({ projectPath, sessionId, recordingId, speakerId, text })
      return { id: utterances.length }
    },
    getSpeakers: () => []
  }
}

const noopIdentifier: SpeakerIdentifier = () => ({ speakerId: null, confidence: 0 })

describe('SpeechSession', () => {
  it('starts in listening state after construction', () => {
    const session = new SpeechSession(
      { sessionId: 1, projectPath: '/p' },
      {
        worker: fakeWorker([]),
        db: fakeDb(),
        identifier: noopIdentifier,
        whisperModel: fakeWhisperModel,
        saveRecording: () => '/audio.webm',
        emit: () => {}
      }
    )
    expect(session.state).toBe('listening')
  })

  it('emits one utterance event per non-empty chunk and persists each utterance', async () => {
    const db = fakeDb()
    const emit = vi.fn()
    const events: Array<{ text: string; utterance_id: number }> = []

    const session = new SpeechSession(
      { sessionId: 42, projectPath: '/proj' },
      {
        worker: fakeWorker([
          { text: 'hello world', embedding: null },
          { text: 'second utterance', embedding: null }
        ]),
        db,
        identifier: noopIdentifier,
        whisperModel: fakeWhisperModel,
        saveRecording: () => '/recording.webm',
        emit
      }
    )

    session.onUtterance((evt) => events.push({ text: evt.text, utterance_id: evt.utterance_id }))

    await session.acceptChunk(new ArrayBuffer(8))
    await session.acceptChunk(new ArrayBuffer(8))

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ text: 'hello world', utterance_id: 1 })
    expect(events[1]).toMatchObject({ text: 'second utterance', utterance_id: 2 })

    expect(db.utterances).toHaveLength(2)
    expect(db.utterances[0]).toMatchObject({ sessionId: 42, text: 'hello world' })
    expect(db.utterances[1]).toMatchObject({ sessionId: 42, text: 'second utterance' })

    expect(db.recordings).toHaveLength(2)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('drops empty transcriptions silently', async () => {
    const db = fakeDb()
    const emit = vi.fn()

    const session = new SpeechSession(
      { sessionId: 1, projectPath: '/p' },
      {
        worker: fakeWorker([{ text: null, embedding: null }]),
        db,
        identifier: noopIdentifier,
        whisperModel: fakeWhisperModel,
        saveRecording: () => '/x',
        emit
      }
    )

    await session.acceptChunk(new ArrayBuffer(4))

    expect(db.utterances).toHaveLength(0)
    expect(db.recordings).toHaveLength(0)
    expect(emit).not.toHaveBeenCalled()
  })

  it('ignores chunks after close()', async () => {
    const db = fakeDb()
    const session = new SpeechSession(
      { sessionId: 1, projectPath: '/p' },
      {
        worker: fakeWorker([{ text: 'late', embedding: null }]),
        db,
        identifier: noopIdentifier,
        whisperModel: fakeWhisperModel,
        saveRecording: () => '/x',
        emit: () => {}
      }
    )

    await session.close()
    await session.acceptChunk(new ArrayBuffer(4))

    expect(db.utterances).toHaveLength(0)
    expect(session.state).toBe('closed')
  })

  it('close() is idempotent', async () => {
    const session = new SpeechSession(
      { sessionId: 1, projectPath: '/p' },
      {
        worker: fakeWorker([]),
        db: fakeDb(),
        identifier: noopIdentifier,
        whisperModel: fakeWhisperModel,
        saveRecording: () => '/x',
        emit: () => {}
      }
    )

    await session.close()
    await session.close()
    expect(session.state).toBe('closed')
  })

  it('attaches speaker name when identifier resolves a speaker', async () => {
    const db: SpeechDB = {
      addRecording: () => ({ id: 1 }),
      createUtterance: () => ({ id: 1 }),
      getSpeakers: () => [{ id: 7, name: 'Andrew' }]
    }
    const events: Array<{ speaker_id: number | null; speaker_name: string | null }> = []

    const session = new SpeechSession(
      { sessionId: 1, projectPath: '/p' },
      {
        worker: fakeWorker([{ text: 'hi', embedding: [0.1, 0.2] }]),
        db,
        identifier: () => ({ speakerId: 7, confidence: 0.9 }),
        whisperModel: fakeWhisperModel,
        saveRecording: () => '/x',
        emit: () => {}
      }
    )
    session.onUtterance((e) => events.push({ speaker_id: e.speaker_id, speaker_name: e.speaker_name }))

    await session.acceptChunk(new ArrayBuffer(4))

    expect(events).toEqual([{ speaker_id: 7, speaker_name: 'Andrew' }])
  })
})
