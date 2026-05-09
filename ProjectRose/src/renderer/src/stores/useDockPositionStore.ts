import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DockPositionState {
  offsetX: number
  setOffsetX: (x: number) => void
}

export const useDockPositionStore = create<DockPositionState>()(
  persist(
    (set) => ({
      offsetX: 0,
      setOffsetX: (x) => set({ offsetX: x })
    }),
    { name: 'rose-dock-position' }
  )
)
