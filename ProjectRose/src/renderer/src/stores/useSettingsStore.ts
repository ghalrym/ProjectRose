import { create } from 'zustand'
import type { ModelConfig, RouterConfig } from '@shared/types'
import { useProjectStore } from './useProjectStore'
import { useStatusStore } from './useStatusStore'

interface SettingsState {
  heartbeatEnabled: boolean
  heartbeatIntervalMinutes: number
  micDeviceId: string
  userName: string
  agentName: string
  roseSpeechSpeakerId: number | null
  activeListeningSetupComplete: boolean
  activeListeningDraftSeconds: number
  models: ModelConfig[]
  defaultModelId: string
  providerKeys: { anthropic: string; openai: string; bedrock: { region: string; accessKeyId: string; secretAccessKey: string }; projectrose: { accessToken: string; refreshToken: string; email: string; plan: string } | null }
  router: RouterConfig
  hostMode: 'projectrose' | 'self'
  includeThinkingInContext: boolean
  ollamaBaseUrl: string
  openaiCompatBaseUrl: string
  openaiCompatApiKey: string
  extensions: Record<string, Record<string, unknown>>
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Omit<SettingsState, 'loaded' | 'load' | 'update'>>) => Promise<void>
}

// Prevents a stale rootPath-less load from overwriting a newer rootPath-specific load.
let loadGeneration = 0

// Debounces "Settings saved" notifications across rapid update() bursts (e.g. typing in a text field).
let saveNotifyTimer: ReturnType<typeof setTimeout> | null = null

export const useSettingsStore = create<SettingsState>()((set) => ({
  heartbeatEnabled: true,
  heartbeatIntervalMinutes: 5,
  micDeviceId: '',
  userName: '',
  agentName: 'Rose',
  roseSpeechSpeakerId: null,
  activeListeningSetupComplete: false,
  activeListeningDraftSeconds: 8,
  models: [],
  defaultModelId: '',
  providerKeys: { anthropic: '', openai: '', bedrock: { region: 'us-east-1', accessKeyId: '', secretAccessKey: '' }, projectrose: null },
  router: { enabled: false, modelName: '' },
  hostMode: 'self',
  includeThinkingInContext: false,
  ollamaBaseUrl: 'http://localhost:11434',
  openaiCompatBaseUrl: '',
  openaiCompatApiKey: '',
  extensions: {},
  loaded: false,

  load: async () => {
    const gen = ++loadGeneration
    set({ loaded: false })
    const rootPath = useProjectStore.getState().rootPath ?? undefined
    const s = await window.api.getSettings(rootPath)
    if (gen !== loadGeneration) return
    // Only mark loaded:true once we have a project rootPath.
    // A rootPath-less load returns global defaults (heartbeatEnabled:true) which
    // must not unblock the heartbeat before the project-specific settings arrive.
    set({ ...s, loaded: rootPath !== undefined })
  },

  update: async (patch) => {
    set(patch as Partial<SettingsState>)
    const rootPath = useProjectStore.getState().rootPath ?? undefined
    const s = await window.api.setSettings(patch, rootPath)
    set({ ...s })
    if (saveNotifyTimer) clearTimeout(saveNotifyTimer)
    saveNotifyTimer = setTimeout(() => {
      useStatusStore.getState().notify('Settings saved', { tone: 'success' })
      saveNotifyTimer = null
    }, 500)
  }
}))
