import { create } from 'zustand'
import type { NavItem, ModelConfig, RouterConfig } from '@shared/types'
import { useProjectStore } from './useProjectStore'
import { useStatusStore } from './useStatusStore'

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { viewId: 'chat',     label: 'Agent',    visible: true },
  { viewId: 'apps',     label: 'Apps',     visible: true },
  { viewId: 'editor',   label: 'Editor',   visible: true },
  { viewId: 'settings', label: 'Settings', visible: true },
]

interface SettingsState {
  heartbeatEnabled: boolean
  heartbeatIntervalMinutes: number
  micDeviceId: string
  userName: string
  agentName: string
  roseSpeechSpeakerId: number | null
  activeListeningSetupComplete: boolean
  navItems: NavItem[]
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

function mergeNavItems(persisted: NavItem[] | undefined): NavItem[] {
  const defaults = DEFAULT_NAV_ITEMS.map((def) => {
    const p = persisted?.find((n) => n.viewId === def.viewId)
    return p ? { ...p, label: def.label } : def
  })
  const defaultIds = new Set(DEFAULT_NAV_ITEMS.map((n) => n.viewId))
  // Only preserve extension nav items — identified by the "rose-" prefix convention.
  // Internal views (like "account") that may be stored in persisted settings are excluded.
  const extensions = persisted?.filter((n) => !defaultIds.has(n.viewId) && n.viewId.startsWith('rose-')) ?? []
  return [...defaults, ...extensions]
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
  navItems: DEFAULT_NAV_ITEMS,
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
    const navItems = mergeNavItems(s.navItems as NavItem[] | undefined)
    // Only mark loaded:true once we have a project rootPath.
    // A rootPath-less load returns global defaults (heartbeatEnabled:true) which
    // must not unblock the heartbeat before the project-specific settings arrive.
    set({ ...s, navItems, loaded: rootPath !== undefined })
  },

  update: async (patch) => {
    set(patch as Partial<SettingsState>)
    const rootPath = useProjectStore.getState().rootPath ?? undefined
    const s = await window.api.setSettings(patch, rootPath)
    const navItems = mergeNavItems(s.navItems as NavItem[] | undefined)
    set({ ...s, navItems })
    if (saveNotifyTimer) clearTimeout(saveNotifyTimer)
    saveNotifyTimer = setTimeout(() => {
      useStatusStore.getState().notify('Settings saved', { tone: 'success' })
      saveNotifyTimer = null
    }, 500)
  }
}))
