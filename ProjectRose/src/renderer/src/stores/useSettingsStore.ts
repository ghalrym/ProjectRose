import { create } from 'zustand'
import type { ModelConfig, RouterConfig } from '@shared/types'
import { useProjectStore } from './useProjectStore'
import { useStatusStore } from './useStatusStore'

interface SettingsState {
  micDeviceId: string
  userName: string
  agentName: string
  roseSpeechSpeakerId: number | null
  activeListeningSetupComplete: boolean
  activeListeningDraftSeconds: number
  whisperModel: string
  models: ModelConfig[]
  defaultModelId: string
  providerKeys: { anthropic: string; openai: string; bedrock: { region: string; accessKeyId: string; secretAccessKey: string } }
  router: RouterConfig
  hostMode: 'projectrose' | 'self'
  includeThinkingInContext: boolean
  agentStartsExpanded: boolean
  ollamaBaseUrl: string
  openaiCompatBaseUrl: string
  openaiCompatApiKey: string
  compressionThresholdPct: number
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
  micDeviceId: '',
  userName: '',
  agentName: 'Rose',
  roseSpeechSpeakerId: null,
  activeListeningSetupComplete: false,
  activeListeningDraftSeconds: 8,
  whisperModel: 'Xenova/whisper-tiny.en',
  models: [],
  defaultModelId: '',
  providerKeys: { anthropic: '', openai: '', bedrock: { region: 'us-east-1', accessKeyId: '', secretAccessKey: '' } },
  router: { enabled: false, modelName: '' },
  hostMode: 'self',
  includeThinkingInContext: false,
  agentStartsExpanded: false,
  ollamaBaseUrl: 'http://localhost:11434',
  openaiCompatBaseUrl: '',
  openaiCompatApiKey: '',
  compressionThresholdPct: 0.70,
  extensions: {},
  loaded: false,

  load: async () => {
    const gen = ++loadGeneration
    set({ loaded: false })
    const rootPath = useProjectStore.getState().rootPath ?? undefined
    const s = await window.api.getSettings(rootPath)
    if (gen !== loadGeneration) return
    // Settings are agent-global; rootPath is passed for back-compat but
    // ignored by the host. Mark loaded regardless so the WelcomeView and
    // Settings panel work without a workspace open.
    set({ ...s, loaded: true })
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
