import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import {
  TranscriptionWorkerHandle,
  sharedTranscriptionWorker,
  type WorkerLike
} from '../transcriptionWorkerHandle'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
}

function asWorkerLike(w: FakeWorker): WorkerLike {
  return w as unknown as WorkerLike
}

function setup(): { handle: TranscriptionWorkerHandle; workers: FakeWorker[]; newWorker: ReturnType<typeof vi.fn> } {
  const workers: FakeWorker[] = []
  const newWorker = vi.fn(() => {
    const w = new FakeWorker()
    workers.push(w)
    return asWorkerLike(w)
  })
  const handle = new TranscriptionWorkerHandle({ newWorker })
  return { handle, workers, newWorker }
}

describe('TranscriptionWorkerHandle', () => {
  it('warmup boots a worker lazily and only once', () => {
    const { handle, newWorker } = setup()
    expect(newWorker).not.toHaveBeenCalled()
    handle.warmup()
    expect(newWorker).toHaveBeenCalledOnce()
    handle.warmup()
    expect(newWorker).toHaveBeenCalledOnce()
  })

  it('process posts a processChunk job and resolves on the matching result', async () => {
    const { handle, workers } = setup()
    const buf = new ArrayBuffer(8)
    const promise = handle.process(buf, 'Xenova/whisper-tiny.en')

    expect(workers).toHaveLength(1)
    const w = workers[0]
    expect(w.postMessage).toHaveBeenCalledOnce()
    const msg = w.postMessage.mock.calls[0][0] as {
      type: string
      jobId: number
      whisperModel: string
    }
    expect(msg.type).toBe('processChunk')
    expect(msg.whisperModel).toBe('Xenova/whisper-tiny.en')

    w.emit('message', { type: 'result', jobId: msg.jobId, text: 'hi', embedding: [0.1, 0.2] })
    await expect(promise).resolves.toEqual({ text: 'hi', embedding: [0.1, 0.2] })
  })

  it('process posts a copy of the audio buffer, not the original', () => {
    const { handle, workers } = setup()
    const buf = new ArrayBuffer(8)
    handle.process(buf, 'm')
    const sent = (workers[0].postMessage.mock.calls[0][0] as { audioBuffer: ArrayBuffer }).audioBuffer
    expect(sent).not.toBe(buf)
    expect(sent.byteLength).toBe(buf.byteLength)
  })

  it('routes results to the correct pending job when jobs interleave', async () => {
    const { handle, workers } = setup()
    const p1 = handle.process(new ArrayBuffer(4), 'm')
    const p2 = handle.process(new ArrayBuffer(4), 'm')

    const w = workers[0]
    const job1 = (w.postMessage.mock.calls[0][0] as { jobId: number }).jobId
    const job2 = (w.postMessage.mock.calls[1][0] as { jobId: number }).jobId

    w.emit('message', { type: 'result', jobId: job2, text: 'second', embedding: null })
    w.emit('message', { type: 'result', jobId: job1, text: 'first', embedding: null })

    await expect(p1).resolves.toMatchObject({ text: 'first' })
    await expect(p2).resolves.toMatchObject({ text: 'second' })
  })

  it('rejects pending jobs when the worker exits non-zero', async () => {
    const { handle, workers } = setup()
    const promise = handle.process(new ArrayBuffer(4), 'm')
    workers[0].emit('exit', 1)
    await expect(promise).rejects.toThrow(/exited/)
  })

  it('ignores result messages for unknown jobIds without resolving anything', async () => {
    const { handle, workers } = setup()
    const promise = handle.process(new ArrayBuffer(4), 'm')
    let resolved = false
    promise.then(() => { resolved = true })
    workers[0].emit('message', { type: 'result', jobId: 99999, text: 'x', embedding: null })
    await new Promise((r) => setTimeout(r, 5))
    expect(resolved).toBe(false)
  })

  it('ignores non-result message types (log, error) without throwing', () => {
    const { handle, workers } = setup()
    handle.warmup()
    expect(() => workers[0].emit('message', { type: 'log', message: 'hi' })).not.toThrow()
    expect(() => workers[0].emit('message', { type: 'error', message: 'bad' })).not.toThrow()
  })

  // sharedTranscriptionWorker uses the real `electron`-backed default factory,
  // so we exercise only its identity (idempotent singleton), not its plumbing.
  describe('sharedTranscriptionWorker', () => {
    it('returns the same instance on repeated calls', () => {
      expect(sharedTranscriptionWorker()).toBe(sharedTranscriptionWorker())
    })
  })
})
