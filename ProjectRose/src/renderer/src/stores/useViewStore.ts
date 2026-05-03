import { create } from 'zustand'
import { ActiveView } from '../../../shared/types'

interface ViewState {
  activeView: ActiveView
  sidebarWidth: number
  terminalHeight: number
  isTerminalVisible: boolean
  isChatFullWidth: boolean
  settingsTarget: string | null
  setActiveView: (view: ActiveView) => void
  setSidebarWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
  toggleTerminal: () => void
  toggleChatFullWidth: () => void
  setSettingsTarget: (target: string | null) => void
}

export const useViewStore = create<ViewState>()((set) => ({
  activeView: 'chat',
  sidebarWidth: 240,
  terminalHeight: 200,
  isTerminalVisible: true,
  isChatFullWidth: false,
  settingsTarget: null,
  setActiveView: (view) => set({ activeView: view }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  toggleTerminal: () => set((s) => ({ isTerminalVisible: !s.isTerminalVisible })),
  toggleChatFullWidth: () => set((s) => ({ isChatFullWidth: !s.isChatFullWidth })),
  setSettingsTarget: (target) => set({ settingsTarget: target })
}))
