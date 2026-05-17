import { Worker } from 'worker_threads'
import path from 'path'

/**
 * Result returned by the speech worker for a single chunk.
 */
export interface TranscriptionResult {
  text: string | null
  embedding: number[] | null
}

interface PendingJob {
  resolve: (r: TranscriptionResult) => void
  reject: (e: Error) => void
}

export interface PreloadResult {
  ok: boolean
  alreadyCached: boolean
  error?: string
}

interface PendingPreload {
  resolve: (r: PreloadResult) => void
  reject: (e: Error) => void
  onProgress?: (data: unknown) => void
}

export interface SpeakerPreloadResult {
  ok: boolean
  error?: string
}

interface PendingSpeakerPreload {
  resolve: (r: SpeakerPreloadResult) => void
  reject: (e: Error) => void
}

/**
 * Minimal surface of `worker_threads.Worker` that this handle exercises.
 * Lets tests inject a fake without faking the entire Worker class.
 */
export type WorkerLike = {
  postMessage(msg: unknown): void
  on(event: 'message', handler: (msg: unknown) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'exit', handler: (code: number) => void): void
}

export interface TranscriptionWorkerHandleDeps {
  /** Construct a new worker. Called lazily on first chunk or warmup. */
  newWorker: () => WorkerLike
}

/**
 * Thin wrapper around the speech worker thread. Owns the singleton Worker
 * instance and tracks in-flight jobs by id, returning a Promise per chunk.
 *
 * This is an implementation detail of SpeechSession — sessions hold a
 * reference to this handle; they do not know about Worker, postMessage, or
 * jobIds.
 */
export class TranscriptionWorkerHandle {
  private worker: WorkerLike | null = null
  private nextJobId = 0
  private pending = new Map<number, PendingJob>()
  private pendingPreloads = new Map<number, PendingPreload>()
  private pendingSpeakerPreloads = new Map<number, PendingSpeakerPreload>()

  constructor(private deps: TranscriptionWorkerHandleDeps) {}

  private getWorker(): WorkerLike {
    if (this.worker) return this.worker

    const w = this.deps.newWorker()

    w.on('message', (raw: unknown) => {
      const msg = raw as {
        type: string
        jobId?: number
        text?: string | null
        embedding?: number[] | null
        message?: string
        ok?: boolean
        alreadyCached?: boolean
        error?: string
        data?: unknown
      }
      if (msg.type === 'log') { console.log(msg.message); return }
      if (msg.type === 'error') { console.error('[SpeechWorker]', msg.message); return }
      if (msg.type === 'preloadProgress' && msg.jobId !== undefined) {
        const p = this.pendingPreloads.get(msg.jobId)
        try { p?.onProgress?.(msg.data) } catch { /* progress listeners are best-effort */ }
        return
      }
      if (msg.type === 'preloadDone' && msg.jobId !== undefined) {
        const p = this.pendingPreloads.get(msg.jobId)
        if (!p) return
        this.pendingPreloads.delete(msg.jobId)
        p.resolve({
          ok: msg.ok ?? false,
          alreadyCached: msg.alreadyCached ?? false,
          error: msg.error
        })
        return
      }
      if (msg.type === 'speakerPreloadDone' && msg.jobId !== undefined) {
        const p = this.pendingSpeakerPreloads.get(msg.jobId)
        if (!p) return
        this.pendingSpeakerPreloads.delete(msg.jobId)
        p.resolve({ ok: msg.ok ?? false, error: msg.error })
        return
      }
      if (msg.type !== 'result' || msg.jobId === undefined) return

      const job = this.pending.get(msg.jobId)
      if (!job) return
      this.pending.delete(msg.jobId)
      job.resolve({ text: msg.text ?? null, embedding: msg.embedding ?? null })
    })
    w.on('error', (e: Error) => console.error('[Speech] Worker error:', e))
    w.on('exit', (code: number) => {
      if (code !== 0) console.error(`[Speech] Worker exited with code ${code}`)
      this.worker = null
      // Reject any still-pending jobs so callers don't hang.
      for (const job of this.pending.values()) {
        job.reject(new Error('Speech worker exited'))
      }
      this.pending.clear()
      for (const p of this.pendingPreloads.values()) {
        p.reject(new Error('Speech worker exited'))
      }
      this.pendingPreloads.clear()
      for (const p of this.pendingSpeakerPreloads.values()) {
        p.reject(new Error('Speech worker exited'))
      }
      this.pendingSpeakerPreloads.clear()
    })

    this.worker = w
    return w
  }

  /**
   * Pre-warm the worker process so the first chunk isn't bottlenecked on
   * worker boot.
   */
  warmup(): void {
    this.getWorker()
  }

  /**
   * Submit a chunk for transcription + speaker embedding. Resolves when the
   * worker reports back; rejects if the worker exits before then.
   *
   * `whisperModel` is passed per call so the engine can hot-swap models
   * without the session caching its own copy.
   */
  process(audioBuffer: ArrayBuffer, whisperModel: string): Promise<TranscriptionResult> {
    const jobId = this.nextJobId++
    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject })
      this.getWorker().postMessage({
        type: 'processChunk',
        jobId,
        audioBuffer: audioBuffer.slice(0),
        whisperModel
      })
    })
  }

  /**
   * Eagerly load a whisper model into the worker. Resolves when the pipeline
   * is hot in worker memory. Progress events come through `onProgress`
   * (matches transformers.js progress_callback shape).
   */
  preload(modelId: string, onProgress?: (data: unknown) => void): Promise<PreloadResult> {
    const jobId = this.nextJobId++
    return new Promise<PreloadResult>((resolve, reject) => {
      this.pendingPreloads.set(jobId, { resolve, reject, onProgress })
      this.getWorker().postMessage({ type: 'preloadModel', jobId, modelId })
    })
  }

  /**
   * Eagerly load the speaker-embedding model into the worker. Pairs with
   * `preload()` to fully prepare the worker for an active-listening session.
   */
  preloadSpeaker(): Promise<SpeakerPreloadResult> {
    const jobId = this.nextJobId++
    return new Promise<SpeakerPreloadResult>((resolve, reject) => {
      this.pendingSpeakerPreloads.set(jobId, { resolve, reject })
      this.getWorker().postMessage({ type: 'preloadSpeakerEmbedder', jobId })
    })
  }
}

/**
 * Default Worker factory — spawns the real speechWorker.js with the user
 * data path Electron provides. Defers the electron `require` so this file
 * stays importable under vitest.
 */
function defaultNewWorker(): WorkerLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  return new Worker(path.join(__dirname, 'speechWorker.js'), {
    workerData: { userDataPath: app.getPath('userData') }
  })
}

let _shared: TranscriptionWorkerHandle | null = null

/**
 * The shared worker handle. Sessions reach for this rather than spinning up
 * their own — Whisper and the speaker embedder are heavyweight.
 */
export function sharedTranscriptionWorker(): TranscriptionWorkerHandle {
  if (!_shared) _shared = new TranscriptionWorkerHandle({ newWorker: defaultNewWorker })
  return _shared
}
