import { create } from 'zustand'

interface AppsDrawerState {
  open: boolean
  activeExtensionId: string | null
  mode: 'page' | 'settings'
  toggle: () => void
  close: () => void
  setActiveExtension: (id: string) => void
  setMode: (mode: 'page' | 'settings') => void
}

export const useAppsDrawerStore = create<AppsDrawerState>()((set) => ({
  open: false,
  activeExtensionId: null,
  mode: 'page',
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  setActiveExtension: (id) => set({ activeExtensionId: id, mode: 'page' }),
  setMode: (mode) => set({ mode })
}))
