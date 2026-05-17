import { create } from 'zustand'

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

interface WhisperPreloadStore extends PreloadState {
  initialized: boolean
  init: () => Promise<void>
  start: (modelId: string) => Promise<{ alreadyCached: boolean; ok: boolean; error?: string }>
  clear: () => Promise<void>
}

const INITIAL: PreloadState = {
  modelId: null,
  status: 'idle',
  percent: 0,
  loaded: 0,
  total: 0,
  fileLabel: '',
  error: ''
}

export const useWhisperPreloadStore = create<WhisperPreloadStore>((set, get) => ({
  ...INITIAL,
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    window.api.whisper.onPreloadProgress((payload) => set(payload))
    try {
      const status = await window.api.whisper.getPreloadStatus()
      set(status)
    } catch {
      // ignore — main might not be ready yet
    }
  },

  start: async (modelId) => {
    set({ modelId, status: 'preparing', percent: 0, loaded: 0, total: 0, fileLabel: '', error: '' })
    return await window.api.whisper.preloadModel(modelId)
  },

  clear: async () => {
    try { await window.api.whisper.clearPreloadStatus() } catch { /* ignore */ }
    set(INITIAL)
  }
}))
