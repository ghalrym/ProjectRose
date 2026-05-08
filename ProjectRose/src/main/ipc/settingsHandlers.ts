import { ipcMain, app } from 'electron'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { IPC } from '../../shared/ipcChannels'
import { serviceStatus } from '../services/serviceStatus'

export interface ModelConfig {
  id: string
  displayName: string
  provider: 'anthropic' | 'openai' | 'ollama' | 'openai-compatible' | 'bedrock' | 'projectrose'
  modelName: string
  tags: string[]
}

export interface RouterConfig {
  enabled: boolean
  modelName: string
}

export interface AppSettings {
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
  agentStartsExpanded: boolean
  ollamaBaseUrl: string
  openaiCompatBaseUrl: string
  // Fraction (0..1) of the model's context window at which the compression
  // toast suggests the user compress older turns. Pairs with a separate
  // tool-step threshold in the renderer.
  compressionThresholdPct: number
  // Namespaced extension settings: { 'rose-discord': { global: {...}, project: {...} } }
  extensions: Record<string, Record<string, unknown>>
  // Allow extensions to write arbitrary keys without the host knowing about them.
  [key: string]: unknown
}

const DEFAULT_SETTINGS: AppSettings = {
  heartbeatEnabled: true,
  heartbeatIntervalMinutes: 5,
  micDeviceId: '',
  userName: '',
  agentName: '',
  roseSpeechSpeakerId: null,
  activeListeningSetupComplete: false,
  activeListeningDraftSeconds: 8,
  models: [],
  defaultModelId: '',
  providerKeys: { anthropic: '', openai: '', bedrock: { region: 'us-east-1', accessKeyId: '', secretAccessKey: '' }, projectrose: null },
  router: { enabled: false, modelName: '' },
  hostMode: 'self',
  includeThinkingInContext: false,
  agentStartsExpanded: false,
  ollamaBaseUrl: 'http://localhost:11434',
  openaiCompatBaseUrl: '',
  openaiCompatApiKey: '',
  compressionThresholdPct: 0.70,
  extensions: {}
}

const GLOBAL_SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

// Host-owned secret fields (stored in userData/settings.json, not the
// project repo config). Extensions declare their own sensitive keys via
// registerSensitiveExtensionFields() — the host doesn't enumerate them.
const HOST_SENSITIVE_FIELDS = ['providerKeys'] as const
const extensionSensitiveFields: Set<string> = new Set()

export function registerSensitiveExtensionFields(keys: string[]): void {
  for (const k of keys) extensionSensitiveFields.add(k)
}

function getSensitiveFields(): string[] {
  return [...HOST_SENSITIVE_FIELDS, ...extensionSensitiveFields]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, keys: readonly string[]): any {
  const result: Record<string, unknown> = {}
  for (const k of keys) if (k in obj) result[k] = obj[k]
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function omit(obj: any, keys: readonly string[]): any {
  const keySet = new Set(keys)
  const result: Record<string, unknown> = {}
  for (const k of Object.keys(obj)) if (!keySet.has(k)) result[k] = obj[k]
  return result
}

function getRepoConfigPath(rootPath: string): string {
  return join(rootPath, '.projectrose', 'config.json')
}

export async function readSettings(rootPath?: string): Promise<AppSettings> {
  let globalSettings: Partial<AppSettings> = {}
  try { globalSettings = JSON.parse(await readFile(GLOBAL_SETTINGS_PATH, 'utf-8')) } catch { /* defaults */ }

  const sensitiveKeys = getSensitiveFields()
  // Non-sensitive fields from old userData file serve as migration fallback
  const nonSensitiveFallback: Partial<AppSettings> = omit(globalSettings, sensitiveKeys)

  let repoConfig: Partial<AppSettings> = {}
  if (rootPath) {
    try { repoConfig = JSON.parse(await readFile(getRepoConfigPath(rootPath), 'utf-8')) } catch { /* not created yet */ }
  }

  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...nonSensitiveFallback,
    ...repoConfig,
    ...pick(globalSettings, sensitiveKeys)
  }

  // Drop any legacy navItems entry — the host no longer has a navigation bar.
  delete (merged as Record<string, unknown>).navItems

  return merged
}

export async function writeSettings(settings: AppSettings, rootPath?: string): Promise<void> {
  const sensitiveKeys = getSensitiveFields()
  let existing: Partial<AppSettings> = {}
  try { existing = JSON.parse(await readFile(GLOBAL_SETTINGS_PATH, 'utf-8')) } catch { /* ok */ }
  await writeFile(GLOBAL_SETTINGS_PATH, JSON.stringify({ ...existing, ...pick(settings, sensitiveKeys) }, null, 2), 'utf-8')

  if (rootPath) {
    const repoData = omit(settings, sensitiveKeys)
    await mkdir(dirname(getRepoConfigPath(rootPath)), { recursive: true })
    await writeFile(getRepoConfigPath(rootPath), JSON.stringify(repoData, null, 2), 'utf-8')
  }
}


export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, (_event, rootPath?: string) => readSettings(rootPath))

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, patch: Partial<AppSettings>, rootPath?: string) => {
    const current = await readSettings(rootPath)
    const updated = { ...current, ...patch }
    await writeSettings(updated, rootPath)
    return updated
  })

  ipcMain.handle(IPC.HEALTH_CHECK_ALL, async () => {
    serviceStatus.roseSpeech = true
    return []
  })
}
