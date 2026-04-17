import { create } from 'zustand'

interface TerminalState {
  sessionId: string | null
  initialize: (cwd?: string) => Promise<void>
  dispose: () => void
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  sessionId: null,

  initialize: async (cwd?: string) => {
    // Always dispose old session before creating a new one
    const old = get().sessionId
    if (old) {
      try { await window.api.disposeTerminal(old) } catch {}
    }

    try {
      const sessionId = await window.api.spawnTerminal(cwd ? { cwd } : undefined)
      set({ sessionId })
    } catch (err) {
      console.error('Failed to spawn terminal:', err)
      set({ sessionId: null })
    }
  },

  dispose: () => {
    const { sessionId } = get()
    if (sessionId) {
      window.api.disposeTerminal(sessionId)
    }
    set({ sessionId: null })
  }
}))
