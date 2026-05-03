import { create } from 'zustand'

export type UpdaterPhase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdaterState {
  phase: UpdaterPhase
  toastVisible: boolean
  version: string | null
  releaseNotes: string | null
  progressPercent: number
  errorMessage: string | null
  setAvailable: (info: { version: string; releaseNotes: string | null }) => void
  setProgress: (percent: number) => void
  setDownloaded: (info: { version: string; releaseNotes: string | null }) => void
  setError: (message: string) => void
  hideToast: () => void
  showToast: () => void
  dismiss: () => void
  requestDownload: () => Promise<void>
  requestSkip: () => Promise<void>
  requestInstall: () => Promise<void>
}

export const useUpdaterStore = create<UpdaterState>()((set, get) => ({
  phase: 'idle',
  toastVisible: false,
  version: null,
  releaseNotes: null,
  progressPercent: 0,
  errorMessage: null,
  setAvailable: ({ version, releaseNotes }) => {
    const { phase, version: currentVersion } = get()
    if (phase !== 'idle' && currentVersion === version) return
    set({
      phase: 'available',
      toastVisible: true,
      version,
      releaseNotes,
      progressPercent: 0,
      errorMessage: null
    })
  },
  setProgress: (percent) => set({ progressPercent: percent }),
  setDownloaded: ({ version, releaseNotes }) =>
    set({
      phase: 'ready',
      toastVisible: true,
      version,
      releaseNotes: releaseNotes ?? null,
      progressPercent: 100,
      errorMessage: null
    }),
  setError: (message) =>
    set({ phase: 'error', toastVisible: true, errorMessage: message }),
  hideToast: () => set({ toastVisible: false }),
  showToast: () => set({ toastVisible: true }),
  dismiss: () =>
    set({
      phase: 'idle',
      toastVisible: false,
      version: null,
      releaseNotes: null,
      progressPercent: 0,
      errorMessage: null
    }),
  requestDownload: async () => {
    set({ phase: 'downloading', toastVisible: true, progressPercent: 0, errorMessage: null })
    await window.api.updater.downloadUpdate()
  },
  requestSkip: async () => {
    const { version } = get()
    if (version) await window.api.updater.skipVersion(version)
    set({
      phase: 'idle',
      toastVisible: false,
      version: null,
      releaseNotes: null,
      progressPercent: 0,
      errorMessage: null
    })
  },
  requestInstall: async () => {
    await window.api.updater.installUpdate()
  }
}))
