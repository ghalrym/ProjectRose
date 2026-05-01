type Format = 'pcm' | 'wav' | 'mp3'

let ctx: AudioContext | null = null
let nextStartTime = 0
const liveSources = new Set<AudioBufferSourceNode>()

// Network chunks aren't aligned to 16-bit sample boundaries — keep the trailing
// odd byte per stream so the next chunk pairs it back up.
const carryBytes = new Map<string, Uint8Array>()

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function pcm16ToAudioBuffer(audioCtx: AudioContext, pcm: Uint8Array, sampleRate: number): AudioBuffer {
  const samples = pcm.byteLength >>> 1
  const buffer = audioCtx.createBuffer(1, samples, sampleRate)
  const channel = buffer.getChannelData(0)
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  for (let i = 0; i < samples; i++) {
    channel[i] = view.getInt16(i * 2, true) / 32768
  }
  return buffer
}

async function decodeContainer(audioCtx: AudioContext, audio: ArrayBuffer): Promise<AudioBuffer> {
  return audioCtx.decodeAudioData(audio.slice(0))
}

function schedule(audioCtx: AudioContext, buffer: AudioBuffer): void {
  const src = audioCtx.createBufferSource()
  src.buffer = buffer
  src.connect(audioCtx.destination)
  const startAt = Math.max(audioCtx.currentTime, nextStartTime)
  src.start(startAt)
  nextStartTime = startAt + buffer.duration
  liveSources.add(src)
  src.onended = () => { liveSources.delete(src) }
}

export async function enqueueAudio(
  audio: ArrayBuffer,
  format: Format,
  sampleRate: number,
  streamKey: string
): Promise<void> {
  const audioCtx = getCtx()
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume() } catch { /* ignore */ }
  }

  if (format !== 'pcm') {
    schedule(audioCtx, await decodeContainer(audioCtx, audio))
    return
  }

  // PCM: stitch any carried-over byte from the previous chunk on the same stream.
  const carry = carryBytes.get(streamKey)
  const incoming = new Uint8Array(audio)
  let combined: Uint8Array
  if (carry && carry.byteLength > 0) {
    combined = new Uint8Array(carry.byteLength + incoming.byteLength)
    combined.set(carry, 0)
    combined.set(incoming, carry.byteLength)
  } else {
    combined = incoming
  }

  const evenLen = combined.byteLength & ~1
  if (combined.byteLength & 1) {
    carryBytes.set(streamKey, combined.subarray(evenLen))
  } else {
    carryBytes.delete(streamKey)
  }
  if (evenLen === 0) return

  const aligned = combined.subarray(0, evenLen)
  schedule(audioCtx, pcm16ToAudioBuffer(audioCtx, aligned, sampleRate))
}

export function flushStream(streamKey: string): void {
  carryBytes.delete(streamKey)
}

export function cancelPlayback(): void {
  for (const src of liveSources) {
    try { src.stop() } catch { /* already stopped */ }
  }
  liveSources.clear()
  carryBytes.clear()
  nextStartTime = ctx?.currentTime ?? 0
}
