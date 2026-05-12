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

/**
 * Thin wrapper around the speech worker thread. Owns the singleton Worker
 * instance and tracks in-flight jobs by id, returning a Promise per chunk.
 *
 * This is an implementation detail of SpeechSession — sessions hold a
 * reference to this handle; they do not know about Worker, postMessage, or
 * jobIds.
 */
export class TranscriptionWorkerHandle {
  private worker: Worker | null = null
  private nextJobId = 0
  private pending = new Map<number, PendingJob>()

  private getWorker(): Worker {
    if (this.worker) return this.worker

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    const w = new Worker(path.join(__dirname, 'speechWorker.js'), {
      workerData: { userDataPath: app.getPath('userData') }
    })

    w.on('message', (msg: {
      type: string
      jobId?: number
      text?: string | null
      embedding?: number[] | null
      message?: string
    }) => {
      if (msg.type === 'log') { console.log(msg.message); return }
      if (msg.type === 'error') { console.error('[SpeechWorker]', msg.message); return }
      if (msg.type !== 'result' || msg.jobId === undefined) return

      const job = this.pending.get(msg.jobId)
      if (!job) return
      this.pending.delete(msg.jobId)
      job.resolve({ text: msg.text ?? null, embedding: msg.embedding ?? null })
    })
    w.on('error', (e) => console.error('[Speech] Worker error:', e))
    w.on('exit', (code) => {
      if (code !== 0) console.error(`[Speech] Worker exited with code ${code}`)
      this.worker = null
      // Reject any still-pending jobs so callers don't hang.
      for (const job of this.pending.values()) {
        job.reject(new Error('Speech worker exited'))
      }
      this.pending.clear()
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
}

let _shared: TranscriptionWorkerHandle | null = null

/**
 * The shared worker handle. Sessions reach for this rather than spinning up
 * their own — Whisper and the speaker embedder are heavyweight.
 */
export function sharedTranscriptionWorker(): TranscriptionWorkerHandle {
  if (!_shared) _shared = new TranscriptionWorkerHandle()
  return _shared
}
