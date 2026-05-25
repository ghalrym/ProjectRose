import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import {
  piperBinaryPath,
  piperVoiceConfigPath,
  piperVoiceModelPath
} from './paths'
import { isPiperBinaryInstalled, isVoiceInstalled } from './voiceManager'

interface PiperVoiceConfig {
  audio?: { sample_rate?: number }
  sample_rate?: number
}

function readVoiceSampleRate(voiceId: string): number {
  // Piper voices declare sample_rate either at the top level or nested under
  // .audio depending on the model generation. Default to 22050 Hz (the rate
  // every medium-quality voice in our catalog uses) if the config file is
  // missing or malformed.
  try {
    const cfg = JSON.parse(readFileSync(piperVoiceConfigPath(voiceId), 'utf-8')) as PiperVoiceConfig
    return cfg.audio?.sample_rate ?? cfg.sample_rate ?? 22050
  } catch {
    return 22050
  }
}

function wrapPcmInWav(pcm: Buffer, sampleRate: number): Buffer {
  // 16-bit mono PCM → minimal RIFF/WAVE wrapper. Matches what HTMLAudioElement
  // happily plays from a Blob URL without re-decoding.
  const header = Buffer.alloc(44)
  const dataLen = pcm.length
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLen, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataLen, 40)
  return Buffer.concat([header, pcm])
}

export interface SynthesizeArgs {
  text: string
  // Parent model id, e.g. 'en_US-amy-medium' — never includes a `#speakerKey`
  // suffix. Used to locate the .onnx + .onnx.json on disk.
  modelId: string
  // For multi-speaker models (l2arctic, libritts, …) the integer index Piper
  // expects at `--speaker <n>`. Null for single-speaker models.
  speakerIndex: number | null
  speed?: number
  signal?: AbortSignal
}

export async function synthesizeWithPiper(args: SynthesizeArgs): Promise<Buffer> {
  if (!isPiperBinaryInstalled()) {
    throw new Error('Piper engine is not installed yet.')
  }
  if (!isVoiceInstalled(args.modelId)) {
    throw new Error(`Voice "${args.modelId}" is not installed.`)
  }
  const speed = Math.max(0.5, Math.min(2.0, args.speed ?? 1.0))
  // Piper uses length_scale where >1 = slower, <1 = faster — invert speed.
  const lengthScale = (1 / speed).toFixed(3)

  const piperArgs = [
    '--model', piperVoiceModelPath(args.modelId),
    '--output-raw',
    '--length-scale', lengthScale
  ]
  if (args.speakerIndex !== null && args.speakerIndex !== undefined) {
    piperArgs.push('--speaker', String(args.speakerIndex))
  }

  return await new Promise<Buffer>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    const child = spawn(piperBinaryPath(), piperArgs, { windowsHide: true })

    const chunks: Buffer[] = []
    let stderrBuf = ''
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => { stderrBuf += c.toString() })
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => finish(() => {
      if (args.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      if (code !== 0) {
        reject(new Error(`Piper exited ${code}: ${stderrBuf.trim() || 'unknown error'}`))
        return
      }
      const pcm = Buffer.concat(chunks)
      if (pcm.length === 0) {
        reject(new Error('Piper produced no audio.'))
        return
      }
      resolve(wrapPcmInWav(pcm, readVoiceSampleRate(args.modelId)))
    }))

    const onAbort = (): void => {
      try { child.kill() } catch { /* already gone */ }
    }
    if (args.signal) {
      if (args.signal.aborted) {
        onAbort()
      } else {
        args.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdin.end(args.text, 'utf-8')
  })
}
