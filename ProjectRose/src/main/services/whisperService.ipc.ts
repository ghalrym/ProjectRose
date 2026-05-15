import { defineIpc, method } from '../../shared/ipc/defineIpc'

export const whisperIpc = defineIpc('whisper', {
  transcribe: method<[audioBuffer: ArrayBuffer], string>()
})
