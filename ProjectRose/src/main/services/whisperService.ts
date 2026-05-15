import { readSettings } from './settingsService'
import { transcribe, setModel } from './speech/transcriptionEngine'

export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const settings = await readSettings()
  setModel(settings.whisperModel)
  return transcribe(audioBuffer)
}
