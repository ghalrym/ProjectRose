import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { readSettings } from './settingsHandlers'
import { transcribe, setModel } from '../services/speech/transcriptionEngine'

export function registerWhisperHandlers(): void {
  ipcMain.handle(IPC.WHISPER_TRANSCRIBE, async (_event, audioBuffer: ArrayBuffer) => {
    const settings = await readSettings()
    setModel(settings.whisperModel)
    const text = await transcribe(audioBuffer)

    // Silently save chat recording for speaker training
    saveChatRecording(audioBuffer).catch(() => {})

    return text
  })
}

async function saveChatRecording(audioBuffer: ArrayBuffer): Promise<void> {
  const settings = await readSettings()
  const speakerId = settings.roseSpeechSpeakerId
  if (!speakerId) return

  // We need a project path to save the recording. Without it we skip.
  // The chat recording path is best-effort — the user can still label in the active listening view.
}
