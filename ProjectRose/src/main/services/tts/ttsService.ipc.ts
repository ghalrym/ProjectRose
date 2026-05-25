import { defineIpc, method } from '../../../shared/ipc/defineIpc'
import type { SynthesizeRequest, SynthesizeResult, TtsReadinessResult } from './ttsService'
import type { CatalogStatusEntry } from './voiceManager'

// Request channels. Download progress is a separate broadcast channel
// (IPC.TTS_DOWNLOAD_PROGRESS) emitted via webContents.send; it doesn't fit
// the invoke/return shape because downloads are long-running and stream.
export const ttsIpc = defineIpc('tts', {
  synthesize: method<[req: SynthesizeRequest], SynthesizeResult>(),
  cancel: method<[jobId: string], { cancelled: boolean }>(),
  cancelAll: method<[], { ok: true }>(),
  getReadiness: method<[], TtsReadinessResult>(),
  listVoices: method<[], CatalogStatusEntry[]>(),
  refreshCatalog: method<[], { count: number }>(),
  downloadVoice: method<[voiceId: string], { ok: true }>(),
  uninstallVoice: method<[voiceId: string], { ok: true }>()
})
