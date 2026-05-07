import { create } from 'zustand'

interface AppsDrawerState {
  open: boolean
  toggle: () => void
  close: () => void
}

export const useAppsDrawerStore = create<AppsDrawerState>()((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}))
