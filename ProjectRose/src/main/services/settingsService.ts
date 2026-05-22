import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { agentSettingsPath } from '../lib/agentHome'
import { serviceStatus } from './serviceStatus'
import { DEFAULT_MEMORY_SETTINGS, type MemorySettings } from '../../shared/memory'

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
  lastMainView: 'bloom' | 'editor'
  ollamaBaseUrl: string
  openaiCompatBaseUrl: string
  // Fraction (0..1) of the model's context window at which the compression
  // toast suggests the user compress older turns. Pairs with a separate
  // tool-step threshold in the renderer.
  compressionThresholdPct: number
  // Memory subsystem (host-level, agent-global at ~/.rose/memory/). The
  // diary scheduler reads enabled + time; the renderer Memory tab writes
  // them through the same settings:set IPC.
  memory: MemorySettings
  // Allow callers to read/write arbitrary keys we don't enumerate.
  [key: string]: unknown
}

const DEFAULT_SETTINGS: AppSettings = {
  micDeviceId: '',
  userName: '',
  agentName: '',
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
  lastMainView: 'bloom',
  ollamaBaseUrl: 'http://localhost:11434',
  openaiCompatBaseUrl: '',
  openaiCompatApiKey: '',
  compressionThresholdPct: 0.70,
  memory: DEFAULT_MEMORY_SETTINGS
}

export async function readSettings(_rootPath?: string): Promise<AppSettings> {
  const path = agentSettingsPath()
  let stored: Partial<AppSettings> = {}
  try { stored = JSON.parse(await readFile(path, 'utf-8')) } catch { /* defaults */ }

  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    // memory is a nested block — shallow-merge so stored partials don't drop
    // newly-introduced default keys.
    memory: { ...DEFAULT_MEMORY_SETTINGS, ...(stored.memory ?? {}) }
  }

  // Drop any legacy navItems entry — the host no longer has a navigation bar.
  delete (merged as Record<string, unknown>).navItems

  // Drop any legacy providerKeys.projectrose blob — the cookie-derived token
  // is incompatible with the new opaque-bearer scheme and lives in
  // safeStorage now (userData/session.bin).
  if (merged.providerKeys && (merged.providerKeys as Record<string, unknown>).projectrose !== undefined) {
    delete (merged.providerKeys as Record<string, unknown>).projectrose
  }

  // Strip the legacy per-extension namespaced blob if a pre-refactor
  // ~/.rose/settings.json (or the carried-over userData/settings.json) still
  // has it. Extensions read/write their own per-workspace settings now.
  delete (merged as Record<string, unknown>).extensions

  return merged
}

export async function writeSettings(settings: AppSettings, _rootPath?: string): Promise<void> {
  const path = agentSettingsPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(settings, null, 2), 'utf-8')
}

export async function applySettingsPatch(
  patch: Partial<AppSettings>,
  rootPath?: string
): Promise<AppSettings> {
  const current = await readSettings(rootPath)
  const updated = { ...current, ...patch }
  await writeSettings(updated, rootPath)
  return updated
}

export interface ServiceHealth {
  name: string
  url: string
  status: 'up' | 'down'
  latency?: number
}

export async function checkServicesHealth(): Promise<ServiceHealth[]> {
  serviceStatus.roseSpeech = true
  return []
}
