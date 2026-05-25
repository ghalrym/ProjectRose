import { existsSync, createWriteStream } from 'fs'
import { mkdir, readdir, rm, stat, writeFile, chmod } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  piperBinaryDir,
  piperBinaryPath,
  piperDownloadDir,
  piperVoiceConfigPath,
  piperVoiceDir,
  piperVoiceModelPath,
  piperVoicesDir
} from './paths'
import { findVoice, getCatalog, type VoiceCatalogEntry } from './voiceCatalog'

const execFileAsync = promisify(execFile)

// Pinned Piper release — the schema of the bundled espeak-ng data must match
// what the engine expects, so we don't auto-track HEAD. Bump deliberately.
const PIPER_RELEASE_TAG = '2023.11.14-2'

interface BinaryDownload {
  url: string
  filename: string
  // strip-components value for tar/zip extraction so the binary lands directly
  // in piperBinaryDir() without a leading "piper/" folder.
  stripComponents: number
}

function binaryDownloadForPlatform(): BinaryDownload {
  const base = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE_TAG}`
  const platform = process.platform
  const arch = process.arch
  if (platform === 'win32' && arch === 'x64') {
    return { url: `${base}/piper_windows_amd64.zip`, filename: 'piper_windows_amd64.zip', stripComponents: 1 }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { url: `${base}/piper_macos_aarch64.tar.gz`, filename: 'piper_macos_aarch64.tar.gz', stripComponents: 1 }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return { url: `${base}/piper_macos_x64.tar.gz`, filename: 'piper_macos_x64.tar.gz', stripComponents: 1 }
  }
  if (platform === 'linux' && arch === 'x64') {
    return { url: `${base}/piper_linux_x86_64.tar.gz`, filename: 'piper_linux_x86_64.tar.gz', stripComponents: 1 }
  }
  if (platform === 'linux' && arch === 'arm64') {
    return { url: `${base}/piper_linux_aarch64.tar.gz`, filename: 'piper_linux_aarch64.tar.gz', stripComponents: 1 }
  }
  if (platform === 'linux' && arch === 'arm') {
    return { url: `${base}/piper_linux_armv7l.tar.gz`, filename: 'piper_linux_armv7l.tar.gz', stripComponents: 1 }
  }
  throw new Error(`Unsupported platform for Piper: ${platform}/${arch}`)
}

export type ProgressFn = (p: { stage: string; percent: number; bytesLoaded: number; bytesTotal: number }) => void

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

async function downloadFile(args: {
  url: string
  destPath: string
  stage: string
  onProgress?: ProgressFn
  signal?: AbortSignal
}): Promise<void> {
  const { url, destPath, stage, onProgress, signal } = args
  await ensureDir(piperDownloadDir())
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  let loaded = 0

  // Stream the body to disk while emitting periodic progress events. We tee
  // through a transform-like callback rather than buffering the whole file in
  // memory — voice models are ~63 MB and the binary tarball is ~30 MB, both
  // fine to stream straight to disk.
  const reader = res.body.getReader()
  const out = createWriteStream(destPath)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) throw new Error('aborted')
      out.write(Buffer.from(value))
      loaded += value.byteLength
      if (onProgress && total > 0) {
        onProgress({ stage, percent: (loaded / total) * 100, bytesLoaded: loaded, bytesTotal: total })
      } else if (onProgress) {
        onProgress({ stage, percent: 0, bytesLoaded: loaded, bytesTotal: 0 })
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  }
}

async function extractArchive(archivePath: string, destDir: string, stripComponents: number): Promise<void> {
  // Both modern Windows (10+) and macOS/Linux ship `tar` (bsdtar) that can
  // extract .tar.gz and .zip. Using a single tool keeps the dependency count
  // at zero — no extract-zip, no native tar binding.
  await ensureDir(destDir)
  const args = ['-xf', archivePath, '-C', destDir]
  if (stripComponents > 0) {
    args.push(`--strip-components=${stripComponents}`)
  }
  await execFileAsync('tar', args)
}

export function isPiperBinaryInstalled(): boolean {
  return existsSync(piperBinaryPath())
}

export function isVoiceInstalled(voiceId: string): boolean {
  return existsSync(piperVoiceModelPath(voiceId)) && existsSync(piperVoiceConfigPath(voiceId))
}

export async function listInstalledVoices(): Promise<string[]> {
  try {
    const dirs = await readdir(piperVoicesDir(), { withFileTypes: true })
    const ids: string[] = []
    for (const d of dirs) {
      if (d.isDirectory() && isVoiceInstalled(d.name)) ids.push(d.name)
    }
    return ids
  } catch {
    return []
  }
}

export async function installPiperBinary(args: {
  onProgress?: ProgressFn
  signal?: AbortSignal
} = {}): Promise<void> {
  if (isPiperBinaryInstalled()) return
  const dl = binaryDownloadForPlatform()
  await ensureDir(piperDownloadDir())
  const archivePath = join(piperDownloadDir(), dl.filename)
  await downloadFile({
    url: dl.url,
    destPath: archivePath,
    stage: 'engine',
    onProgress: args.onProgress,
    signal: args.signal
  })
  await ensureDir(piperBinaryDir())
  await extractArchive(archivePath, piperBinaryDir(), dl.stripComponents)
  if (process.platform !== 'win32') {
    try { await chmod(piperBinaryPath(), 0o755) } catch { /* best-effort */ }
  }
  try { await rm(archivePath) } catch { /* leave the file if cleanup fails */ }
  if (!isPiperBinaryInstalled()) {
    throw new Error('Piper binary not found after extraction. The download may be corrupted.')
  }
}

export async function installVoice(voiceId: string, args: {
  onProgress?: ProgressFn
  signal?: AbortSignal
} = {}): Promise<void> {
  if (isVoiceInstalled(voiceId)) return
  const voice = await findVoice(voiceId)
  if (!voice) throw new Error(`Unknown voice: ${voiceId}`)
  const dir = piperVoiceDir(voiceId)
  await ensureDir(dir)
  await downloadFile({
    url: voice.configUrl,
    destPath: piperVoiceConfigPath(voiceId),
    stage: 'voice-config',
    onProgress: args.onProgress,
    signal: args.signal
  })
  await downloadFile({
    url: voice.modelUrl,
    destPath: piperVoiceModelPath(voiceId),
    stage: 'voice-model',
    onProgress: args.onProgress,
    signal: args.signal
  })
  if (!isVoiceInstalled(voiceId)) {
    throw new Error('Voice files missing after download.')
  }
}

export async function deleteVoice(voiceId: string): Promise<void> {
  const dir = piperVoiceDir(voiceId)
  try { await rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

export interface CatalogStatusEntry extends VoiceCatalogEntry {
  installed: boolean
}

export async function listCatalogWithStatus(): Promise<CatalogStatusEntry[]> {
  const catalog = await getCatalog()
  return catalog.map((v) => ({ ...v, installed: isVoiceInstalled(v.id) }))
}

export async function voiceFileSize(voiceId: string): Promise<number | null> {
  try {
    const s = await stat(piperVoiceModelPath(voiceId))
    return s.size
  } catch {
    return null
  }
}

// Touch a marker file so the next launch can spot a corrupt mid-download state
// (a model.onnx that's smaller than the .onnx.json claims). Currently unused
// — kept exported so a future health-check IPC can read it without touching
// fs/promises in the renderer.
export async function writeInstallReceipt(voiceId: string, payload: Record<string, unknown>): Promise<void> {
  const file = join(piperVoiceDir(voiceId), 'install.json')
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf-8')
}
