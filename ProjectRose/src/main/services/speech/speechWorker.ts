import { workerData, parentPort } from 'worker_threads'
import {
  initCacheDir as initWhisperCache,
  transcribeWav,
  setModel as setWhisperModel,
  loadModel as loadWhisperModel
} from './transcriptionEngine'
import { initCacheDir as initSpeakerCache, embed, getEmbedder } from './speakerService'
import { webmToWav, cleanupWav } from './audioService'

interface WorkerInit { userDataPath: string }
const { userDataPath } = workerData as WorkerInit

// initCacheDir in each service prepends 'hf-models' to this path
initWhisperCache(userDataPath)
initSpeakerCache(userDataPath)

interface ChunkJob {
  kind: 'chunk'
  jobId: number
  audioBuffer: ArrayBuffer
  whisperModel: string
}

interface PreloadJob {
  kind: 'preload'
  jobId: number
  modelId: string
}

interface SpeakerPreloadJob {
  kind: 'speakerPreload'
  jobId: number
}

type Job = ChunkJob | PreloadJob | SpeakerPreloadJob

const queue: Job[] = []
let busy = false

parentPort!.on('message', (raw: unknown) => {
  const msg = raw as {
    type: string
    jobId?: number
    audioBuffer?: ArrayBuffer
    whisperModel?: string
    modelId?: string
  }

  if (msg.type === 'processChunk') {
    // Backpressure only applies to chunks. Preload jobs are never dropped.
    const chunkCount = queue.filter((j) => j.kind === 'chunk').length
    if (chunkCount >= 2) {
      const oldestChunkIdx = queue.findIndex((j) => j.kind === 'chunk')
      if (oldestChunkIdx >= 0) {
        const dropped = queue.splice(oldestChunkIdx, 1)[0] as ChunkJob
        parentPort!.postMessage({ type: 'log', message: '[SpeechWorker] Queue full, dropping oldest chunk' })
        parentPort!.postMessage({ type: 'result', jobId: dropped.jobId, text: null, embedding: null })
      }
    }
    queue.push({
      kind: 'chunk',
      jobId: msg.jobId!,
      audioBuffer: msg.audioBuffer!,
      whisperModel: msg.whisperModel!
    })
  } else if (msg.type === 'preloadModel') {
    queue.push({
      kind: 'preload',
      jobId: msg.jobId!,
      modelId: msg.modelId!
    })
  } else if (msg.type === 'preloadSpeakerEmbedder') {
    queue.push({
      kind: 'speakerPreload',
      jobId: msg.jobId!
    })
  } else {
    return
  }

  if (!busy) drain()
})

function drain(): void {
  if (!queue.length) { busy = false; return }
  busy = true
  const job = queue.shift()!
  const promise =
    job.kind === 'preload' ? runPreload(job)
    : job.kind === 'speakerPreload' ? runPreloadSpeaker(job)
    : runChunk(job)
  promise
    .catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      parentPort!.postMessage({ type: 'error', message })
      if (job.kind === 'preload') {
        parentPort!.postMessage({
          type: 'preloadDone',
          jobId: job.jobId,
          ok: false,
          alreadyCached: false,
          error: message
        })
      } else if (job.kind === 'speakerPreload') {
        parentPort!.postMessage({
          type: 'speakerPreloadDone',
          jobId: job.jobId,
          ok: false,
          error: message
        })
      } else {
        parentPort!.postMessage({ type: 'result', jobId: job.jobId, text: null, embedding: null })
      }
    })
    .finally(() => drain())
}

async function runChunk({ jobId, audioBuffer, whisperModel }: ChunkJob): Promise<void> {
  setWhisperModel(whisperModel)
  let wavPath: string | null = null
  try {
    wavPath = await webmToWav(audioBuffer)
    const text = await transcribeWav(wavPath)
    if (!text) {
      parentPort!.postMessage({ type: 'result', jobId, text: null, embedding: null })
      return
    }
    const embedding = await embed(wavPath)
    parentPort!.postMessage({ type: 'result', jobId, text, embedding })
  } finally {
    if (wavPath) cleanupWav(wavPath)
  }
}

async function runPreload({ jobId, modelId }: PreloadJob): Promise<void> {
  const { alreadyCached } = await loadWhisperModel(modelId, (data) => {
    parentPort!.postMessage({ type: 'preloadProgress', jobId, data })
  })
  parentPort!.postMessage({ type: 'preloadDone', jobId, ok: true, alreadyCached })
}

async function runPreloadSpeaker({ jobId }: SpeakerPreloadJob): Promise<void> {
  const ok = await getEmbedder()
  parentPort!.postMessage({ type: 'speakerPreloadDone', jobId, ok })
}
