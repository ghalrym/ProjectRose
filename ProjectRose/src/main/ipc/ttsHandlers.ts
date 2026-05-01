import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { readSettings, type TtsConfig } from './settingsHandlers'
import { synthesize, listVoices, describeFetchError } from '../services/tts/ttsService'

interface TurnQueue {
  chain: Promise<void>
  ctrl: AbortController
}

const turns = new Map<string, TurnQueue>()

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function dropTurn(reqId: string): void {
  const q = turns.get(reqId)
  if (!q) return
  q.ctrl.abort()
  turns.delete(reqId)
}

export function registerTtsHandlers(): void {
  ipcMain.handle(IPC.TTS_SPEAK, async (_event, reqId: string, text: string) => {
    if (!text.trim()) return { ok: true }

    const settings = await readSettings()
    const cfg = settings.tts
    if (!cfg.enabled) return { ok: false, error: 'tts disabled' }
    if (!cfg.baseUrl || !cfg.model) return { ok: false, error: 'tts not configured' }

    let q = turns.get(reqId)
    if (!q) {
      q = { chain: Promise.resolve(), ctrl: new AbortController() }
      turns.set(reqId, q)
    }
    const queue = q

    queue.chain = queue.chain.then(async () => {
      if (queue.ctrl.signal.aborted) return
      try {
        for await (const chunk of synthesize(text, cfg, queue.ctrl.signal)) {
          notifyRenderer(IPC.TTS_AUDIO_CHUNK, {
            reqId,
            audio: chunk.audio,
            format: chunk.format,
            sampleRate: chunk.sampleRate
          })
        }
      } catch (err) {
        const aborted = queue.ctrl.signal.aborted
        if (!aborted) {
          const message = err instanceof Error ? err.message : String(err)
          notifyRenderer(IPC.TTS_AUDIO_END, { reqId, ok: false, aborted: false, error: message })
        }
      }
    })

    return { ok: true }
  })

  ipcMain.handle(IPC.TTS_CANCEL, (_event, reqId?: string) => {
    if (reqId) { dropTurn(reqId); return }
    for (const id of [...turns.keys()]) dropTurn(id)
  })

  ipcMain.handle(IPC.TTS_TEST, async (_event, reqId: string, text: string, override?: Partial<TtsConfig>) => {
    console.log('[tts:test] received from renderer:', {
      reqId,
      textLength: typeof text === 'string' ? text.length : `NOT_A_STRING(${typeof text})`,
      textPreview: typeof text === 'string' ? text.slice(0, 200) : text,
      overrideVoice: override?.voice,
      overrideModel: override?.model,
      overrideKeys: override ? Object.keys(override) : null
    })
    const settings = await readSettings()
    const cfg: TtsConfig = { ...settings.tts, ...(override ?? {}) }
    console.log('[tts:test] resolved cfg:', {
      baseUrl: cfg.baseUrl, model: cfg.model, voice: cfg.voice, format: cfg.format, sampleRate: cfg.sampleRate
    })
    if (!cfg.baseUrl) return { ok: false, error: 'Base URL is required' }
    if (!cfg.model) return { ok: false, error: 'Model is required' }
    if (!cfg.voice) return { ok: false, error: 'Voice is required' }
    if (!text.trim()) return { ok: false, error: 'Test phrase is empty' }

    const ctrl = new AbortController()
    try {
      let chunks = 0
      let totalBytes = 0
      for await (const chunk of synthesize(text, cfg, ctrl.signal)) {
        chunks++
        totalBytes += chunk.audio.byteLength
        notifyRenderer(IPC.TTS_AUDIO_CHUNK, {
          reqId,
          audio: chunk.audio,
          format: chunk.format,
          sampleRate: chunk.sampleRate
        })
      }
      if (chunks === 0) return { ok: false, error: 'Server returned no audio' }
      return { ok: true, chunks, bytes: totalBytes }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TTS_LIST_VOICES, async (_event, override?: Partial<TtsConfig>) => {
    const settings = await readSettings()
    const cfg = { ...settings.tts, ...(override ?? {}) }
    if (!cfg.baseUrl) return { ok: false, error: 'Base URL is required' }
    try {
      const v = await listVoices(cfg)
      return { ok: true, voices: v.voices, uploadedVoices: v.uploadedVoices }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : describeFetchError(err) }
    }
  })
}
