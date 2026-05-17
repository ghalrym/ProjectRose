import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { PreloadState } from './speech/modelPreloader'

export const whisperIpc = defineIpc('whisper', {
  transcribe: method<[audioBuffer: ArrayBuffer], string>(),
  preloadModel: method<[modelId: string], { alreadyCached: boolean; ok: boolean; error?: string }>(),
  getPreloadStatus: method<[], PreloadState>(),
  clearPreloadStatus: method<[], void>()
})
