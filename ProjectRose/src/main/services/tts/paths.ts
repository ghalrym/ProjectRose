import { join } from 'path'
import { agentHomePath } from '../../lib/agentHome'

export function piperRootDir(): string {
  return join(agentHomePath(), 'cache', 'piper')
}

export function piperDownloadDir(): string {
  return join(piperRootDir(), 'dl')
}

export function piperBinaryDir(): string {
  return join(piperRootDir(), 'bin')
}

export function piperVoicesDir(): string {
  return join(piperRootDir(), 'voices')
}

// Multi-speaker voices encode the speaker key after a `#` (e.g.
// `en_US-l2arctic-medium#ABA`). The filesystem stays keyed by the parent
// model id — all 23 l2arctic speakers share one .onnx + .onnx.json — so
// every path helper strips the suffix before touching disk.
export function modelIdOf(voiceId: string): string {
  const hash = voiceId.indexOf('#')
  return hash < 0 ? voiceId : voiceId.slice(0, hash)
}

export function piperVoiceDir(voiceId: string): string {
  return join(piperVoicesDir(), modelIdOf(voiceId))
}

export function piperBinaryName(): string {
  return process.platform === 'win32' ? 'piper.exe' : 'piper'
}

export function piperBinaryPath(): string {
  return join(piperBinaryDir(), piperBinaryName())
}

export function piperVoiceModelPath(voiceId: string): string {
  const id = modelIdOf(voiceId)
  return join(piperVoicesDir(), id, `${id}.onnx`)
}

export function piperVoiceConfigPath(voiceId: string): string {
  const id = modelIdOf(voiceId)
  return join(piperVoicesDir(), id, `${id}.onnx.json`)
}
