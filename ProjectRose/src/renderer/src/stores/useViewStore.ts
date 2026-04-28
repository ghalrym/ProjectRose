import { create } from 'zustand'
import { ActiveView } from '../../../shared/types'

interface ViewState {
  activeView: ActiveView
  sidebarWidth: number
  terminalHeight: number
  isTerminalVisible: boolean
  settingsTarget: string | null
  setActiveView: (view: ActiveView) => void
  setSidebarWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
  toggleTerminal: () => void
  setSettingsTarget: (target: string | null) => void
}

export const useViewStore = create<ViewState>()((set) => ({
  activeView: 'chat',
  sidebarWidth: 240,
  terminalHeight: 200,
  isTerminalVisible: true,
  settingsTarget: null,
  setActiveView: (view) => set({ activeView: view }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  toggleTerminal: () => set((s) => ({ isTerminalVisible: !s.isTerminalVisible })),
  setSettingsTarget: (target) => set({ settingsTarget: target })
}))
