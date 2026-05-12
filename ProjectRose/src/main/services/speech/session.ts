import { IPC } from '../../../shared/ipcChannels'
import { emitToRenderer } from '../../lib/mainEventBus'
import { saveRecording } from './audioService'
import { identify } from './speakerService'
import * as defaultDb from './speechDB'
import {
  sharedTranscriptionWorker,
  type TranscriptionWorkerHandle,
  type TranscriptionResult
} from './transcriptionWorkerHandle'

export type SpeechSessionState = 'idle' | 'listening' | 'closing' | 'closed'

/**
 * Shape of the utterance event emitted to listeners (and forwarded to the
 * renderer via IPC).
 */
export interface UtteranceEvent {
  sessionId: number
  utterance_id: number
  speaker_id: number | null
  speaker_name: string | null
  text: string
}

export type UtteranceListener = (evt: UtteranceEvent) => void

/**
 * Minimal slice of speechDB the session needs. Carried as a dependency so
 * tests can pass a fake.
 */
export interface SpeechDB {
  addRecording: typeof defaultDb.addRecording
  createUtterance: typeof defaultDb.createUtterance
  getSpeakers: typeof defaultDb.getSpeakers
}

/**
 * Identifies the speaker for an utterance from an embedding. Defaults to the
 * stored-embeddings cosine match; tests can inject a fake.
 */
export type SpeakerIdentifier = (
  embedding: number[] | null,
  projectPath: string
) => { speakerId: number | null; confidence: number }

const defaultIdentifier: SpeakerIdentifier = (embedding, projectPath) => {
  if (!embedding) return { speakerId: null, confidence: 0 }
  return identify(embedding, projectPath)
}

/**
 * Saves a recording to disk; injected so tests don't write to the filesystem.
 */
export type RecordingSink = (
  projectPath: string,
  speakerId: number | null,
  audioBuffer: ArrayBuffer
) => string

/**
 * Read the whisper model id to use for each chunk. Defaults to the live
 * settings; tests pass a stub.
 */
export type WhisperModelProvider = () => Promise<string>

const defaultWhisperModelProvider: WhisperModelProvider = async () => {
  // Deferred import so this module can be loaded under vitest, which has no
  // Electron runtime (settingsHandlers depends on electron transitively).
  const { readSettings } = await import('../../ipc/settingsHandlers')
  const settings = await readSettings()
  return settings.whisperModel
}

export interface SpeechSessionDeps {
  worker?: TranscriptionWorkerHandle
  db?: SpeechDB
  identifier?: SpeakerIdentifier
  saveRecording?: RecordingSink
  emit?: (channel: string, payload: unknown) => void
  whisperModel?: WhisperModelProvider
}

export interface SpeechSessionOptions {
  sessionId: number
  projectPath: string
}

/**
 * One live speech session: receives audio chunks, transcribes them via the
 * shared worker, identifies the speaker, persists the utterance, and emits
 * an event for each one.
 *
 * Sessions are constructed per `sessionId` and own all the state previously
 * smeared across `liveSession.ts` module scope (active set, pending jobs).
 */
export class SpeechSession {
  readonly sessionId: number
  readonly projectPath: string

  private _state: SpeechSessionState = 'idle'
  private listeners = new Set<UtteranceListener>()
  private inflight = new Set<Promise<void>>()

  private worker: TranscriptionWorkerHandle
  private db: SpeechDB
  private identifier: SpeakerIdentifier
  private saveRecording: RecordingSink
  private emit: (channel: string, payload: unknown) => void
  private whisperModelProvider: WhisperModelProvider

  constructor(opts: SpeechSessionOptions, deps: SpeechSessionDeps = {}) {
    this.sessionId = opts.sessionId
    this.projectPath = opts.projectPath
    this.worker = deps.worker ?? sharedTranscriptionWorker()
    this.db = deps.db ?? defaultDb
    this.identifier = deps.identifier ?? defaultIdentifier
    this.saveRecording = deps.saveRecording ?? saveRecording
    this.emit = deps.emit ?? emitToRenderer
    this.whisperModelProvider = deps.whisperModel ?? defaultWhisperModelProvider

    // Pre-warm the worker so the first chunk doesn't pay for boot.
    this.worker.warmup()
    this._state = 'listening'
  }

  get state(): SpeechSessionState {
    return this._state
  }

  /**
   * Subscribe to utterance events. Returns an unsubscribe function.
   */
  onUtterance(listener: UtteranceListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Accept a chunk of webm audio. Returns when the chunk has been queued; the
   * actual transcription happens asynchronously and produces an utterance
   * event when it completes (or no event for silence).
   *
   * Chunks received after `close()` are dropped.
   */
  async acceptChunk(audioBuffer: ArrayBuffer): Promise<void> {
    if (this._state !== 'listening') return

    const job = this.runChunk(audioBuffer)
    this.inflight.add(job)
    job.finally(() => this.inflight.delete(job))
    await job
  }

  /**
   * Close the session. Idempotent. Stops accepting chunks and flushes
   * in-flight ones so their utterances reach the DB. Does NOT write the
   * DB session's `ended_at` — that is the caller's responsibility via
   * `speechDB.endSession`, kept separate so callers can close-then-archive
   * or close-then-resume without coupling.
   */
  async close(): Promise<void> {
    if (this._state === 'closing' || this._state === 'closed') return
    this._state = 'closing'

    // Wait for any chunks that were accepted before close() to finish so
    // their utterances make it into the DB.
    await Promise.allSettled(Array.from(this.inflight))

    this.listeners.clear()
    this._state = 'closed'
  }

  private async runChunk(audioBuffer: ArrayBuffer): Promise<void> {
    let result: TranscriptionResult
    try {
      const whisperModel = await this.whisperModelProvider()
      result = await this.worker.process(audioBuffer, whisperModel)
    } catch (e) {
      console.error('[Speech] worker process failed:', e)
      return
    }

    if (!result.text) return

    const { speakerId, confidence } = this.identifier(result.embedding, this.projectPath)

    let speakerName: string | null = null
    if (speakerId !== null) {
      const speakers = this.db.getSpeakers(this.projectPath) as Array<{ id: number; name: string }>
      speakerName = speakers.find((s) => s.id === speakerId)?.name ?? null
    }

    const audioPath = this.saveRecording(this.projectPath, speakerId, audioBuffer)
    const recording = this.db.addRecording(
      this.projectPath,
      speakerId,
      audioPath,
      'active_listening',
      this.projectPath,
      null
    )
    const utterance = this.db.createUtterance(
      this.projectPath,
      this.sessionId,
      recording.id,
      speakerId,
      result.text
    )

    console.log(
      `[Speech] utterance ${utterance.id}: "${result.text}" (speaker: ${speakerName ?? 'unknown'}, conf: ${confidence.toFixed(2)})`
    )

    const evt: UtteranceEvent = {
      sessionId: this.sessionId,
      utterance_id: utterance.id,
      speaker_id: speakerId,
      speaker_name: speakerName,
      text: result.text
    }

    for (const l of this.listeners) {
      try { l(evt) } catch (e) { console.error('[Speech] utterance listener threw:', e) }
    }
    this.emit(IPC.ACTIVE_LISTENING_UTTERANCE, { type: 'utterance', ...evt })
  }
}
