import { create } from 'zustand'

interface SettingsState {
  heartbeatEnabled: boolean
  heartbeatIntervalMinutes: number
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<{ heartbeatEnabled: boolean; heartbeatIntervalMinutes: number }>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  heartbeatEnabled: true,
  heartbeatIntervalMinutes: 5,
  loaded: false,

  load: async () => {
    const s = await window.api.getSettings()
    set({ ...s, loaded: true })
  },

  update: async (patch) => {
    const s = await window.api.setSettings(patch)
    set(s)
  }
}))
