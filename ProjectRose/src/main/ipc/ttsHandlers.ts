import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import {
  cancelAllSynthesis,
  cancelSynthesis,
  downloadVoice,
  getReadiness,
  listVoiceCatalog,
  refreshVoiceCatalog,
  synthesize,
  uninstallVoice,
  type ProgressCallback
} from '../services/tts/ttsService'
import { ttsIpc } from '../services/tts/ttsService.ipc'

// Per-voice download tracking: a second `downloadVoice` call for the same id
// while one is in-flight should attach to the existing progress rather than
// start a parallel fetch. Tiny enough that we don't need a dedicated module.
const inFlightDownloads = new Map<string, Promise<void>>()

function broadcastProgress(payload: {
  voiceId: string
  stage: string
  percent: number
  bytesLoaded: number
  bytesTotal: number
  status: 'preparing' | 'downloading' | 'ready' | 'error'
  error?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.TTS_DOWNLOAD_PROGRESS, payload)
  }
}

export function registerTtsManifest(): void {
  ttsIpc.register({
    synthesize: (req) => synthesize(req),
    cancel: async (jobId) => ({ cancelled: cancelSynthesis(jobId) }),
    cancelAll: async () => {
      cancelAllSynthesis()
      return { ok: true as const }
    },
    getReadiness: () => getReadiness(),
    listVoices: () => listVoiceCatalog(),
    refreshCatalog: () => refreshVoiceCatalog(),
    downloadVoice: async (voiceId) => {
      const existing = inFlightDownloads.get(voiceId)
      if (existing) {
        await existing
        return { ok: true as const }
      }
      const onProgress: ProgressCallback = (p) => {
        broadcastProgress({
          voiceId,
          stage: p.stage,
          percent: p.percent,
          bytesLoaded: p.bytesLoaded,
          bytesTotal: p.bytesTotal,
          status: 'downloading'
        })
      }
      broadcastProgress({
        voiceId, stage: 'preparing', percent: 0, bytesLoaded: 0, bytesTotal: 0, status: 'preparing'
      })
      const task = downloadVoice({ voiceId, onProgress })
        .then(() => {
          broadcastProgress({
            voiceId, stage: 'ready', percent: 100, bytesLoaded: 0, bytesTotal: 0, status: 'ready'
          })
        })
        .catch((err: unknown) => {
          broadcastProgress({
            voiceId,
            stage: 'error',
            percent: 0,
            bytesLoaded: 0,
            bytesTotal: 0,
            status: 'error',
            error: err instanceof Error ? err.message : String(err)
          })
          throw err
        })
        .finally(() => {
          inFlightDownloads.delete(voiceId)
        })
      inFlightDownloads.set(voiceId, task)
      await task
      return { ok: true as const }
    },
    uninstallVoice: async (voiceId) => {
      await uninstallVoice(voiceId)
      return { ok: true as const }
    }
  })
}
