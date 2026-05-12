import { workerData, parentPort } from 'worker_threads'
import { initCacheDir as initWhisperCache, transcribe, setModel as setWhisperModel } from './whisperService'
import { initCacheDir as initSpeakerCache, embed } from './speakerService'
import { webmToWav, cleanupWav } from './audioService'

interface WorkerInit { userDataPath: string }
const { userDataPath } = workerData as WorkerInit

// initCacheDir in each service prepends 'hf-models' to this path
initWhisperCache(userDataPath)
initSpeakerCache(userDataPath)

interface ChunkJob {
  jobId: number
  audioBuffer: ArrayBuffer
  whisperModel: string
}

const queue: ChunkJob[] = []
let busy = false

parentPort!.on('message', (msg: { type: string } & ChunkJob) => {
  if (msg.type !== 'processChunk') return

  if (queue.length >= 2) {
    const dropped = queue.shift()!
    parentPort!.postMessage({ type: 'log', message: '[SpeechWorker] Queue full, dropping oldest chunk' })
    // Resolve the dropped job as a no-op so the caller's promise settles.
    parentPort!.postMessage({ type: 'result', jobId: dropped.jobId, text: null, embedding: null })
  }

  queue.push({
    jobId: msg.jobId,
    audioBuffer: msg.audioBuffer,
    whisperModel: msg.whisperModel
  })

  if (!busy) drain()
})

function drain(): void {
  if (!queue.length) { busy = false; return }
  busy = true
  const job = queue.shift()!
  runJob(job)
    .catch((e) => {
      parentPort!.postMessage({ type: 'error', message: String(e) })
      // Settle the job's promise even on failure.
      parentPort!.postMessage({ type: 'result', jobId: job.jobId, text: null, embedding: null })
    })
    .finally(() => drain())
}

async function runJob({ jobId, audioBuffer, whisperModel }: ChunkJob): Promise<void> {
  let wavPath: string | null = null
  try {
    setWhisperModel(whisperModel)
    wavPath = await webmToWav(audioBuffer)
    const text = await transcribe(wavPath)
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
