import { app, ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { initCacheDir as initSpeakerCache } from '../services/speech/speakerService'
import { activeSpeechSessionRegistry } from '../services/speech/activeSpeechService'
import { sendSpeechChunk } from '../services/speech/sessionLifecycle'

// Trimmed hand-written file — the typed manifest declares the 11 invoke
// channels. Only the two fire-and-forget `ipcMain.on` handlers stay here,
// plus the one-time speaker-cache init.
export function registerActiveSpeechHandlers(): void {
  // Init cacheDir for training (runs in main thread; worker inits its own copy)
  initSpeakerCache(app.getPath('userData'))

  ipcMain.on(
    IPC.ACTIVE_LISTENING_SEND_CHUNK,
    (_event, payload: { sessionId: number; audioBuffer: ArrayBuffer }) => {
      sendSpeechChunk(activeSpeechSessionRegistry(), payload)
    }
  )

  ipcMain.on(
    IPC.ACTIVE_LISTENING_CANCEL_DRAFT,
    (_event, payload: { sessionId: number }) => {
      activeSpeechSessionRegistry().get(payload.sessionId)?.cancelDraft()
    }
  )
}
