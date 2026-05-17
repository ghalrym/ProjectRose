import { BrowserWindow } from 'electron'
import { IPC } from '../../../shared/ipcChannels'
import { sharedTranscriptionWorker } from './transcriptionWorkerHandle'

export type PreloadStatus = 'idle' | 'preparing' | 'downloading' | 'ready' | 'error'

export interface PreloadState {
  modelId: string | null
  status: PreloadStatus
  percent: number
  loaded: number
  total: number
  fileLabel: string
  error: string
}

const state: PreloadState = {
  modelId: null,
  status: 'idle',
  percent: 0,
  loaded: 0,
  total: 0,
  fileLabel: '',
  error: ''
}

// Per-file byte counters so aggregate percent can blend the model weights,
// tokenizer, and config files into one progress bar.
const fileBytes = new Map<string, { loaded: number; total: number }>()

function broadcast(): void {
  const payload: PreloadState = { ...state }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.WHISPER_PRELOAD_PROGRESS, payload)
  }
}

let _activeLoad: Promise<{ alreadyCached: boolean; ok: boolean; error?: string }> | null = null

export function getPreloadStatus(): PreloadState {
  return { ...state }
}

export function clearPreloadStatus(): void {
  if (_activeLoad) return
  state.modelId = null
  state.status = 'idle'
  state.percent = 0
  state.loaded = 0
  state.total = 0
  state.fileLabel = ''
  state.error = ''
  fileBytes.clear()
  broadcast()
}

interface ProgressData {
  status: string
  name?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

function handleProgress(modelId: string, raw: unknown): void {
  if (state.modelId !== modelId) return
  const data = raw as ProgressData
  if (data.status !== 'progress') return

  const loaded = Number(data.loaded ?? 0)
  const total = Number(data.total ?? 0)
  const file = String(data.file ?? '')
  fileBytes.set(file, { loaded, total })

  let sumLoaded = 0
  let sumTotal = 0
  for (const f of fileBytes.values()) {
    sumLoaded += f.loaded
    sumTotal += f.total
  }
  state.status = 'downloading'
  state.fileLabel = file
  state.loaded = sumLoaded
  state.total = sumTotal
  state.percent = sumTotal > 0 ? Math.min(100, (sumLoaded / sumTotal) * 100) : 0
  broadcast()
}

export function preloadWhisperModel(
  modelId: string
): Promise<{ alreadyCached: boolean; ok: boolean; error?: string }> {
  if (_activeLoad && state.modelId === modelId) return _activeLoad

  state.modelId = modelId
  state.status = 'preparing'
  state.percent = 0
  state.loaded = 0
  state.total = 0
  state.fileLabel = ''
  state.error = ''
  fileBytes.clear()
  broadcast()

  _activeLoad = (async () => {
    try {
      const result = await sharedTranscriptionWorker().preload(modelId, (data) =>
        handleProgress(modelId, data)
      )
      if (!result.ok) {
        const message = result.error || 'Model load failed'
        state.status = 'error'
        state.error = message
        broadcast()
        return { alreadyCached: false, ok: false, error: message }
      }
      state.status = 'ready'
      state.percent = 100
      state.fileLabel = ''
      broadcast()
      return { alreadyCached: result.alreadyCached, ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      state.status = 'error'
      state.error = message
      broadcast()
      return { alreadyCached: false, ok: false, error: message }
    } finally {
      _activeLoad = null
    }
  })()

  return _activeLoad
}
