import { synthesizeWithPiper } from './piperEngine'
import {
  installPiperBinary,
  installVoice,
  isPiperBinaryInstalled,
  isVoiceInstalled,
  listCatalogWithStatus,
  listInstalledVoices,
  deleteVoice as deleteVoiceFiles,
  type CatalogStatusEntry
} from './voiceManager'
import { DEFAULT_VOICE_ID, findVoice, refreshCatalog as refreshCatalogInternal } from './voiceCatalog'

// One abort controller per renderer-issued synthesize job. The renderer's
// TtsAutoPlayer cancels by passing the same jobId to cancel(); we look it up
// here and abort the underlying Piper child process.
const activeJobs = new Map<string, AbortController>()

export type ProgressCallback = (p: {
  stage: string
  percent: number
  bytesLoaded: number
  bytesTotal: number
}) => void

export interface SynthesizeRequest {
  jobId: string
  text: string
  voiceId: string
  speed: number
}

export interface SynthesizeResult {
  wav: ArrayBuffer
}

// Trims/strips content that should not be read aloud. Removed inline so the
// auto-player doesn't have to teach the engine about markdown — the engine
// stays agnostic. Kept conservative: only the obvious noise.
function sanitizeForSpeech(text: string): string {
  let out = text
  // Fenced code blocks (```…```)
  out = out.replace(/```[\s\S]*?```/g, ' [code block omitted] ')
  // Inline code spans (`foo`)
  out = out.replace(/`([^`]+)`/g, '$1')
  // Markdown link syntax — keep the visible text, drop the URL
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // Bold/italic markers (* and _ surrounding words)
  out = out.replace(/(\*\*|__)(.*?)\1/g, '$2')
  out = out.replace(/(\*|_)(.*?)\1/g, '$2')
  // Headings — drop the #s at line start
  out = out.replace(/^#+\s+/gm, '')
  // Collapse whitespace
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return out
}

export async function synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
  const text = sanitizeForSpeech(req.text)
  if (!text) {
    return { wav: new ArrayBuffer(0) }
  }
  // Resolve the catalog entry so multi-speaker ids like
  // `en_US-l2arctic-medium#ABA` route to the right parent model + speaker
  // index. Unknown ids fall through to the raw id as a model name (handles
  // the offline fallback where the catalog is minimal).
  const voice = await findVoice(req.voiceId)
  const modelId = voice?.parentId ?? voice?.id ?? req.voiceId
  const speakerIndex = voice?.speakerIndex ?? null
  const controller = new AbortController()
  activeJobs.set(req.jobId, controller)
  try {
    const wav = await synthesizeWithPiper({
      text,
      modelId,
      speakerIndex,
      speed: req.speed,
      signal: controller.signal
    })
    // ArrayBuffer-only return so structured cloning stays cheap. Slice to drop
    // any extra capacity Node's pool allocator might have left on the Buffer.
    const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)
    return { wav: ab as ArrayBuffer }
  } finally {
    activeJobs.delete(req.jobId)
  }
}

export function cancelSynthesis(jobId: string): boolean {
  const ctrl = activeJobs.get(jobId)
  if (!ctrl) return false
  ctrl.abort()
  activeJobs.delete(jobId)
  return true
}

export function cancelAllSynthesis(): void {
  for (const ctrl of activeJobs.values()) ctrl.abort()
  activeJobs.clear()
}

export interface TtsReadinessResult {
  engineInstalled: boolean
  installedVoices: string[]
  defaultVoiceId: string
}

export async function getReadiness(): Promise<TtsReadinessResult> {
  return {
    engineInstalled: isPiperBinaryInstalled(),
    installedVoices: await listInstalledVoices(),
    defaultVoiceId: DEFAULT_VOICE_ID
  }
}

export async function listVoiceCatalog(): Promise<CatalogStatusEntry[]> {
  return await listCatalogWithStatus()
}

export interface EnsureReadyArgs {
  voiceId: string
  onProgress?: ProgressCallback
  signal?: AbortSignal
}

// Convenience installer used by the "toggle on" flow: install the engine
// (idempotent) then the requested voice (idempotent), reporting progress for
// both phases through a single callback.
export async function ensureReady(args: EnsureReadyArgs): Promise<void> {
  const voice = await findVoice(args.voiceId)
  if (!voice) throw new Error(`Unknown voice: ${args.voiceId}`)
  if (!isPiperBinaryInstalled()) {
    await installPiperBinary({ onProgress: args.onProgress, signal: args.signal })
  }
  if (!isVoiceInstalled(args.voiceId)) {
    await installVoice(args.voiceId, { onProgress: args.onProgress, signal: args.signal })
  }
}

export async function downloadVoice(args: EnsureReadyArgs): Promise<void> {
  if (!isPiperBinaryInstalled()) {
    await installPiperBinary({ onProgress: args.onProgress, signal: args.signal })
  }
  await installVoice(args.voiceId, { onProgress: args.onProgress, signal: args.signal })
}

export async function uninstallVoice(voiceId: string): Promise<void> {
  await deleteVoiceFiles(voiceId)
}

// Forces a re-fetch of the Rhasspy voices.json index from Hugging Face,
// then re-emits the catalog (with install status) so the renderer can show
// any new voices that have landed upstream.
export async function refreshVoiceCatalog(): Promise<{ count: number }> {
  const fresh = await refreshCatalogInternal()
  return { count: fresh.length }
}
