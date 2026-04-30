import { create } from 'zustand'

export type UpdaterPhase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdaterState {
  phase: UpdaterPhase
  modalVisible: boolean
  version: string | null
  releaseNotes: string | null
  progressPercent: number
  errorMessage: string | null
  setAvailable: (info: { version: string; releaseNotes: string | null }) => void
  setProgress: (percent: number) => void
  setDownloaded: (info: { version: string; releaseNotes: string | null }) => void
  setError: (message: string) => void
  hideModal: () => void
  showModal: () => void
}

export const useUpdaterStore = create<UpdaterState>()((set) => ({
  phase: 'idle',
  modalVisible: false,
  version: null,
  releaseNotes: null,
  progressPercent: 0,
  errorMessage: null,
  setAvailable: ({ version, releaseNotes }) =>
    set({
      phase: 'downloading',
      modalVisible: true,
      version,
      releaseNotes,
      progressPercent: 0,
      errorMessage: null
    }),
  setProgress: (percent) => set({ progressPercent: percent }),
  setDownloaded: ({ version, releaseNotes }) =>
    set({
      phase: 'ready',
      modalVisible: true,
      version,
      releaseNotes: releaseNotes ?? null,
      progressPercent: 100,
      errorMessage: null
    }),
  setError: (message) =>
    set({ phase: 'error', modalVisible: true, errorMessage: message }),
  hideModal: () => set({ modalVisible: false }),
  showModal: () => set({ modalVisible: true })
}))
