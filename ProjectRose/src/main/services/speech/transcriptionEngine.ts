import path from 'path'
import { readWavAsPCM, webmToWav, cleanupWav } from './audioService'

type TranscriptionPipeline = (
  input: Float32Array,
  opts: { sampling_rate: number }
) => Promise<{ text: string }>

const DEFAULT_WHISPER_MODEL = 'Xenova/whisper-tiny.en'

let _pipeline: TranscriptionPipeline | null = null
let _pipelineModelId: string | null = null
let _currentModelId = DEFAULT_WHISPER_MODEL
let _cacheDir = ''

export function initCacheDir(dir: string): void { _cacheDir = dir }

export function setModel(modelId: string): void {
  const next = modelId || DEFAULT_WHISPER_MODEL
  if (next === _currentModelId) return
  _currentModelId = next
  // Drop the cached pipeline so the next transcription reloads the new model.
  _pipeline = null
  _pipelineModelId = null
}

async function getPipeline(): Promise<TranscriptionPipeline> {
  if (_pipeline && _pipelineModelId === _currentModelId) return _pipeline

  const { pipeline, env } = await import('@huggingface/transformers')
  env.cacheDir = path.join(_cacheDir, 'hf-models')

  console.log(`[Speech] Loading Whisper model ${_currentModelId} (first use — may take a moment)...`)
  _pipeline = (await pipeline('automatic-speech-recognition', _currentModelId, {
    dtype: 'q8'
  })) as unknown as TranscriptionPipeline
  _pipelineModelId = _currentModelId
  console.log('[Speech] Whisper ready')

  return _pipeline
}

// ~-40 dBFS. Silence and ambient noise sit well below this; normal speech well above.
export const SILENCE_RMS_THRESHOLD = 0.01

export function rms(pcm: Float32Array): number {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  return Math.sqrt(sum / pcm.length)
}

// Whisper commonly hallucinates these patterns on silence or near-silence.
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^\[.*?\]$/,                                  // [Music], [Applause], [Silence], etc.
  /^\(.*?\)$/,                                  // (Music), (piano music), etc.
  /^thank\s+you\.?$/i,
  /^thanks?\s+(for\s+watching)?\.?$/i,
  /^you$/i,
  /^\.+$/,                                      // lone periods
  /^[\s.,!?]+$/,                                // punctuation only
]

export function isSilentOrHallucination(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return true
  if (t.length <= 2) return true                // single char / emoji artifact
  return HALLUCINATION_PATTERNS.some((p) => p.test(t))
}

/**
 * Transcribe a wav file at `wavPath`. Returns the transcribed text, or an
 * empty string if the audio was silence or whisper hallucinated.
 */
export async function transcribeWav(wavPath: string): Promise<string> {
  const pipe = await getPipeline()
  const pcm = readWavAsPCM(wavPath)

  // Gate on energy — don't send silence to Whisper at all.
  if (rms(pcm) < SILENCE_RMS_THRESHOLD) return ''

  const result = await pipe(pcm, { sampling_rate: 16000 })
  const text = result.text.trim()

  if (isSilentOrHallucination(text)) return ''
  return text
}

/**
 * Transcribe a webm audio buffer end-to-end: convert to wav, run whisper,
 * filter silence and hallucinations. This is the entry point both the
 * one-shot chat-input path and the streaming session path call.
 */
export async function transcribe(audioBuffer: ArrayBuffer): Promise<string> {
  let wavPath: string | null = null
  try {
    wavPath = await webmToWav(audioBuffer)
    return await transcribeWav(wavPath)
  } finally {
    if (wavPath) cleanupWav(wavPath)
  }
}
