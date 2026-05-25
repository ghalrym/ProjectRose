import { create } from 'zustand'
import { ActiveView } from '../../../shared/types'
import { logInteraction } from '../lib/interactionLog'

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

// ActiveView is BaseView ('editor' | 'chat' | 'settings') | extension id.
// We also recognize 'account' as a base view at the app level (see App.tsx).
// Any other string is an extension id.
const BASE_VIEWS = new Set(['editor', 'chat', 'settings', 'account'])

export const useViewStore = create<ViewState>()((set, get) => ({
  activeView: 'chat',
  sidebarWidth: 240,
  terminalHeight: 200,
  isTerminalVisible: true,
  isChatFullWidth: false,
  settingsTarget: null,
  setActiveView: (view) => {
    if (get().activeView !== view) {
      if (BASE_VIEWS.has(view)) {
        logInteraction('view.changed', view)
      } else {
        logInteraction('extension.opened', view)
      }
    }
    set({ activeView: view })
  },
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  toggleTerminal: () => {
    logInteraction('view.terminal-toggled')
    set((s) => ({ isTerminalVisible: !s.isTerminalVisible }))
  },
  toggleChatFullWidth: () => {
    logInteraction('view.chat-toggled')
    set((s) => ({ isChatFullWidth: !s.isChatFullWidth }))
  },
  setSettingsTarget: (target) => set({ settingsTarget: target })
}))
