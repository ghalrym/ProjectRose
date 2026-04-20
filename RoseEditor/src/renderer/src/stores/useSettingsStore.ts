import { create } from 'zustand'
import { NavItem } from '../../../shared/types'

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { viewId: 'chat',            label: 'Chat',      visible: true },
  { viewId: 'activeListening', label: 'Listen',    visible: true },
  { viewId: 'docker',          label: 'Docker',    visible: true },
  { viewId: 'git',             label: 'Git',       visible: true },
  { viewId: 'editor',          label: 'Editor',    visible: true },
  { viewId: 'heartbeat',       label: 'Heartbeat', visible: true },
  { viewId: 'settings',        label: 'Settings',  visible: true },
  { viewId: 'email',           label: 'Email',     visible: true },
]

interface SettingsState {
  heartbeatEnabled: boolean
  heartbeatIntervalMinutes: number
  micDeviceId: string
  userName: string
  agentName: string
  roseSpeechSpeakerId: number | null
  activeListeningSetupComplete: boolean
  imapHost: string
  imapPort: number
  imapUser: string
  imapPassword: string
  imapTLS: boolean
  navItems: NavItem[]
  llmProvider: 'anthropic' | 'openai' | 'ollama' | 'openai-compatible'
  llmModel: string
  llmApiKey: string
  llmBaseUrl: string
  llmCompressModel: string
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Omit<SettingsState, 'loaded' | 'load' | 'update'>>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  heartbeatEnabled: true,
  heartbeatIntervalMinutes: 5,
  micDeviceId: '',
  userName: '',
  agentName: '',
  roseSpeechSpeakerId: null,
  activeListeningSetupComplete: false,
  imapHost: '',
  imapPort: 993,
  imapUser: '',
  imapPassword: '',
  imapTLS: true,
  navItems: DEFAULT_NAV_ITEMS,
  llmProvider: 'anthropic' as const,
  llmModel: 'claude-sonnet-4-6',
  llmApiKey: '',
  llmBaseUrl: '',
  llmCompressModel: '',
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
