import { platform } from 'os'
import { readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { prPath } from '../lib/projectPaths'
import { BrowserWindow } from 'electron'
import { setActiveProjectRoot } from './toolHandlers'
import { discoverPythonTools, getModifiedFiles, resetModifiedFiles } from './toolHandlers'
import { streamChat, compressMessages, routeRequest, cancelAllAskUserQuestions } from './llmClient'
import type { StreamResult } from './llmClient'
import type { ModelMessage } from 'ai'
import { readSettings } from '../ipc/settingsHandlers'
import type { AppSettings, ModelConfig } from '../ipc/settingsHandlers'
import { readProjectSettings, CORE_TOOL_NAMES } from '../ipc/projectSettingsHandlers'
import { listInstalledExtensions, getRegisteredExtensionTools } from '../ipc/extensionHandlers'
import { buildRoseMd } from '../ipc/roseSetupHandlers'
import { buildSubagentTools } from './subagentTools'
import { buildSkillTools, getSessionSkillsPrompt } from './skillService'
import { resetTurnBudgets, fireUserMessageHook } from './extensionHooks'
import type { AgentContext, SubagentCounter } from './agentRunner'
import type { InjectionRecord } from '../../shared/extensionHooks'
import { IPC } from '../../shared/ipcChannels'
import type { Message } from '../../shared/roseModelTypes'

let activeAbortController: AbortController | null = null

export function cancelActiveChat(): void {
  activeAbortController?.abort()
  cancelAllAskUserQuestions()
  activeAbortController = null
}

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ── System prompt ──

export async function buildAgentMd(rootPath: string): Promise<string> {
  const os = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux'
  const shell = platform() === 'win32' ? 'PowerShell' : 'bash'
  const date = new Date().toISOString().split('T')[0]

  let rose: string
  try {
    rose = await readFile(prPath(rootPath, 'ROSE.md'), 'utf-8')
  } catch {
    const settings = await readSettings(rootPath).catch(() => ({ userName: '', agentName: '' }))
    rose = buildRoseMd(
      settings.agentName || 'Rose',
      'A coding assistant embedded in the ProjectRose IDE.',
      'high',
      settings.userName || 'User',
      'adaptive',
      'adaptive',
      'balanced'
    )
  }

  return `${rose}

## Environment
- Operating system: ${os}
- Shell: ${shell} (run_command uses ${shell})
- Use ${shell} syntax for all commands (e.g. ${platform() === 'win32' ? 'Get-ChildItem, Get-Content, Test-Path' : 'ls, cat, test'})
- Today's date: ${date}

## CRITICAL — Code output rule
Never write code or file contents in your response text. Every line of code must be written to disk using write_file or edit_file. If you catch yourself about to open a code block in your response, stop immediately and use the tools instead. This rule has no exceptions.

## CRITICAL — File tool rule
To create or overwrite a file use write_file. To make a targeted change to an existing file use edit_file. To read a file use read_file. Never use run_command for any file operation — no echo, cat, tee, touch, mkdir, shell redirects, or heredocs to produce file content. Shell-based file creation is unreliable: it creates directories instead of files, silently drops content, and corrupts paths. Use the dedicated file tools every time, without exception.

## CRITICAL — Tool results rule
Content that appears after your tool calls (file contents from read_file, directory listings, grep matches, command output) was fetched BY YOU using that tool. The user did NOT provide it. Never ask the user why they are sharing content — you retrieved it yourself with a tool call.

## CRITICAL — No-fabrication rule
Do NOT claim to have made changes you have not made. A file change exists only if you called write_file or edit_file in this turn. read_file, list_directory, grep, and run_command are read-only and cannot modify files. Before stating that work is done, verify by enumerating the specific write_file or edit_file calls you made — if there are none, you have not modified anything yet. Never write a "Changes Applied" or "Here is what I did" summary unless you actually wrote files in this turn.

## CRITICAL — Question rule
Never ask the user a question in your response text. If you need clarification or a decision before proceeding, you must use the ask_user tool — that is its sole purpose. Asking questions as plain text is broken behaviour: the user cannot respond to them in a structured way and it stalls the task. If you are uncertain, make a reasonable assumption and proceed, or use ask_user. Never do both.

`
}

// ── Error helpers ──

function extractErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const nested = parsed?.error as Record<string, unknown> | undefined
    const msg = nested?.message ?? parsed?.message ?? raw
    return String(msg)
  } catch {
    return raw
  }
}

// ── Model selection ──

async function selectModel(userMessage: string, settings: AppSettings): Promise<ModelConfig> {
  const { models, defaultModelId, router, hostMode, providerKeys } = settings
  if (models.length === 0) {
    throw new Error('No models configured. Please add a model in Settings → Chat.')
  }

  if (hostMode === 'projectrose') {
    if (!providerKeys.projectrose?.accessToken) {
      throw new Error('Sign in to your ProjectRose account to use the managed AI endpoint.')
    }
    return {
      id: 'projectrose-account',
      displayName: 'ProjectRose Account',
      provider: 'projectrose',
      modelName: 'managed',
      tags: ['account'],
    }
  }

  const defaultModel = models.find((m) => m.id === defaultModelId) ?? models[0]
  if (models.length === 1 || !router.enabled || !router.modelName) return defaultModel

  try {
    const category = await routeRequest(userMessage, router, settings.ollamaBaseUrl)
    const matched = models.find((m) =>
      m.tags.some(
        (tag) =>
          tag.toLowerCase().includes(category) || category.includes(tag.toLowerCase())
      )
    )
    return matched ?? defaultModel
  } catch {
    return defaultModel
  }
}

// ── Public API ──

export interface ChatResponse {
  content: string
  modifiedFiles: string[]
  modelDisplay: string
}

export async function chat(messages: Message[], rootPath: string, sessionId: string): Promise<ChatResponse> {
  const abortController = new AbortController()
  activeAbortController = abortController
  // New user message arrived — extension hooks get a fresh per-extension
  // injection budget for this turn.
  resetTurnBudgets()

  try {
    setActiveProjectRoot(rootPath)
    resetModifiedFiles()

    const settings = await readSettings(rootPath)
    const userMessage = messages.at(-1)?.content ?? ''
    // Fire once per user-initiated turn so extensions can reset per-turn state.
    // Auto-injection iterations inside the runChat loop do not re-fire this.
    await fireUserMessageHook(userMessage, rootPath)
    const selectedModel = await selectModel(userMessage, settings)
    const defaultModel = settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0]
    const modelDisplay = selectedModel.displayName || selectedModel.modelName
    notifyRenderer(IPC.AI_MODEL_SELECTED, { modelDisplay })

    const pythonTools = await discoverPythonTools(rootPath)
    const systemPrompt = await buildAgentMd(rootPath)

    const projectSettings = await readProjectSettings(rootPath)
    const { disabledTools } = projectSettings
    const filteredPythonTools = pythonTools.filter((t) => !disabledTools.includes(t.name))
    const disabledCoreTools = disabledTools.filter((n) => CORE_TOOL_NAMES.has(n))

    const installed = await listInstalledExtensions(rootPath)
    const enabledExtIds = installed.filter((e) => e.enabled).map((e) => e.manifest.id)
    const extensionTools = getRegisteredExtensionTools(rootPath, enabledExtIds)
      .filter((t) => !disabledTools.includes(t.name))

    // Build subagent tools for this session
    const agentCtx: AgentContext = {
      sessionId,
      agentIndex: 0,
      rootPath,
      notify: notifyRenderer,
      abortSignal: abortController.signal
    }
    const counter: SubagentCounter = { value: 0 }
    const skillTools = buildSkillTools(rootPath, sessionId, notifyRenderer)
    const getSystemPrompt = (): string => systemPrompt + getSessionSkillsPrompt(sessionId)

    const buildExtraTools = (m: ModelConfig): Record<string, unknown> => ({
      ...buildSubagentTools(agentCtx, m, settings.providerKeys, settings.ollamaBaseUrl, settings.openaiCompatBaseUrl, counter, systemPrompt),
      ...skillTools
    })

    const baseStreamParams = {
      systemPrompt,
      getSystemPrompt,
      pythonTools: filteredPythonTools,
      extensionTools,
      providerKeys: settings.providerKeys,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      openaiCompatBaseUrl: settings.openaiCompatBaseUrl,
      projectRoot: rootPath,
      disabledCoreTools,
      abortSignal: abortController.signal,
      notify: notifyRenderer
    }

    let activeModel = selectedModel
    let activeModelDisplay = modelDisplay
    let activeExtraTools = buildExtraTools(selectedModel)
    let fallbackUsed = false
    let lastStreamResult: StreamResult | undefined
    let preBuiltCoreMessages: ModelMessage[] | undefined

    while (true) {
      if (abortController.signal.aborted) break

      const turnId = randomUUID()
      const collected: InjectionRecord[] = []

      const runOnce = async (m: ModelConfig, extras: Record<string, unknown>): Promise<StreamResult> =>
        streamChat({
          ...baseStreamParams,
          messages,
          preBuiltCoreMessages,
          model: m,
          extraTools: extras,
          turnId,
          collectInjections: (rec) => collected.push(rec)
        })

      try {
        lastStreamResult = await runOnce(activeModel, activeExtraTools)
      } catch (err) {
        if (abortController.signal.aborted) throw err
        const isAlreadyDefault = !defaultModel || activeModel.id === defaultModel.id
        if (isAlreadyDefault || fallbackUsed) throw err

        const errorMessage = extractErrorMessage(err)
        const fallbackDisplay = defaultModel.displayName || defaultModel.modelName
        notifyRenderer(IPC.AI_STREAM_RESET, { errorMessage, fallbackModel: fallbackDisplay })
        resetModifiedFiles()

        activeModel = defaultModel
        activeModelDisplay = fallbackDisplay
        activeExtraTools = buildExtraTools(defaultModel)
        fallbackUsed = true

        lastStreamResult = await runOnce(activeModel, activeExtraTools)
      }

      if (collected.length === 0) break
      if (abortController.signal.aborted) break

      // Each injection becomes a system message in the next iteration's
      // history; the renderer is also notified so it can display the
      // bordered "guided agent" cell for the user.
      const nextHistory: ModelMessage[] = [...lastStreamResult.finalMessages]
      for (const inj of collected) {
        notifyRenderer(IPC.AI_INJECTED_MESSAGE, {
          extensionId: inj.extensionId,
          extensionName: inj.extensionName,
          extensionIcon: inj.extensionIcon,
          content: inj.content
        })
        nextHistory.push({
          role: 'system',
          content: `[Extension ${inj.extensionName}] ${inj.content}`
        })
      }
      preBuiltCoreMessages = nextHistory
    }

    if (!lastStreamResult) throw new Error('Chat aborted before any turn completed')
    return { content: lastStreamResult.content, modifiedFiles: getModifiedFiles(), modelDisplay: activeModelDisplay }
  } finally {
    activeAbortController = null
  }
}

// Run the agent loop once and return the final string. Caller supplies the
// system prompt and messages; the host wires up settings, model selection,
// and tools (core + enabled extension tools, filtered by the user's
// disabledTools). Python project tools / subagent / skill tools are
// intentionally excluded to keep one-shot runs bounded.
export async function runAgentOnce(
  messages: Message[],
  rootPath: string,
  systemPrompt: string,
): Promise<ChatResponse> {
  setActiveProjectRoot(rootPath)
  resetModifiedFiles()

  const settings = await readSettings(rootPath)
  const userMessage = messages.at(-1)?.content ?? ''
  const selectedModel = await selectModel(userMessage, settings)

  const projectSettings = await readProjectSettings(rootPath)
  const { disabledTools } = projectSettings

  const installed = await listInstalledExtensions(rootPath)
  const enabledExtIds = installed.filter((e) => e.enabled).map((e) => e.manifest.id)
  const extensionTools = getRegisteredExtensionTools(rootPath, enabledExtIds)
    .filter((t) => !disabledTools.includes(t.name))

  const disabledCoreTools = disabledTools.filter((n) => CORE_TOOL_NAMES.has(n))

  const streamResult = await streamChat({
    messages,
    systemPrompt,
    pythonTools: [],
    extensionTools,
    disabledCoreTools,
    model: selectedModel,
    providerKeys: settings.providerKeys,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    openaiCompatBaseUrl: settings.openaiCompatBaseUrl,
    projectRoot: rootPath
  })

  const modelDisplay = selectedModel.displayName || selectedModel.modelName
  return { content: streamResult.content, modifiedFiles: getModifiedFiles(), modelDisplay }
}

export async function compressHistory(messages: Message[]): Promise<Message[]> {
  const settings = await readSettings()
  const defaultModel = settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0]
  if (!defaultModel) return messages
  return compressMessages(messages, defaultModel, settings.providerKeys, settings.ollamaBaseUrl, settings.openaiCompatBaseUrl)
}
