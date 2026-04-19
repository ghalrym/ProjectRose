import { ipcMain } from 'electron'
import { Blob } from 'node:buffer'
import { IPC } from '../../shared/ipcChannels'

export function registerWhisperHandlers(): void {
  ipcMain.handle(IPC.WHISPER_TRANSCRIBE, async (_event, audioBuffer: ArrayBuffer) => {
    const blob = new Blob([audioBuffer], { type: 'audio/webm' })
    const form = new FormData()
    form.append('file', blob, 'recording.webm')

    const res = await fetch('http://127.0.0.1:8010/transcribe', {
      method: 'POST',
      body: form
    })
    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)
    const { text } = await res.json() as { text: string }
    return text
  })
}
