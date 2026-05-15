import { platform } from 'os'
import { readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { prPath } from '../lib/projectPaths'
import { BrowserWindow } from 'electron'
import { streamChat, compressTurnsForContext, routeRequest } from './llmClient'
import type { StreamResult, CompressionResult, ApiShapeMessage } from './llmClient'
import { getContextLength } from './contextLengthRegistry'
import { estimateTokens } from './tokenCounter'
import type { ModelMessage } from 'ai'
import { readSettings } from '../ipc/settingsHandlers'
import type { AppSettings, ModelConfig } from '../ipc/settingsHandlers'
import { readProjectSettings } from '../ipc/projectSettingsHandlers'
import { listInstalledExtensions } from '../ipc/extensionHandlers'
import { buildRoseMd } from '../ipc/roseSetupHandlers'
import { getSessionSkillsPrompt } from './skillService'
import { fireUserMessageHook } from './extensionHooks'
import { loadExtensionPrompts } from '../ipc/promptHandlers'
import type { AgentContext, SubagentCounter } from './agentRunner'
import type { SubagentTurnContext } from './toolRegistry'
import type { InjectionRecord } from '../../shared/extensionHooks'
import { IPC } from '../../shared/ipcChannels'
import type { Message } from '../../shared/roseModelTypes'
import { loadSession } from '../lib/session'
import { ChatSession } from './chatSession'
import { sessionRegistry } from './sessionRegistry'

export function cancelActiveChat(): void {
  sessionRegistry.getActive()?.cancel()
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

  let extensionPromptBlock = ''
  try {
    const sections = await loadExtensionPrompts(rootPath)
    if (sections.length > 0) {
      extensionPromptBlock =
        '\n' +
        sections
          .map((s) => `## Extension: ${s.id}\n\n${s.content.trim()}\n`)
          .join('\n')
    }
  } catch (err) {
    console.error('[prompts] failed to load extension prompts:', err)
  }

  return `${rose}
${extensionPromptBlock}
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
  const { models, defaultModelId, router, hostMode } = settings
  if (models.length === 0) {
    throw new Error('No models configured. Please add a model in Settings → Chat.')
  }

  if (hostMode === 'projectrose') {
    const session = await loadSession()
    if (!session?.token) {
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
  const session = new ChatSession({ sessionId, rootPath })
  sessionRegistry.register(session)
  const abortController = session.abortController
  // Extension hooks get a fresh per-extension injection budget for this
  // turn automatically: a new ChatSession means a new empty `turnBudget`.

  try {
    const settings = await readSettings(rootPath)
    const userMessage = messages.at(-1)?.content ?? ''
    // Fire once per user-initiated turn so extensions can reset per-turn state.
    // Auto-injection iterations inside the runChat loop do not re-fire this.
    await fireUserMessageHook(userMessage, rootPath)
    const selectedModel = await selectModel(userMessage, settings)
    const defaultModel = settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0]
    const modelDisplay = selectedModel.displayName || selectedModel.modelName
    notifyRenderer(IPC.AI_MODEL_SELECTED, { sessionId, modelDisplay })

    const systemPrompt = await buildAgentMd(rootPath)

    const projectSettings = await readProjectSettings(rootPath)
    const { disabledTools } = projectSettings

    const installed = await listInstalledExtensions(rootPath)
    const enabledExtensionIds = installed.filter((e) => e.enabled).map((e) => e.manifest.id)

    // Per-session subagent context. Re-built for each `streamChat` call so
    // a fallback model rebuild picks up the new model without any closure
    // staleness (the prior `buildExtraTools(model)` helper did the same).
    const agentCtx: AgentContext = {
      sessionId,
      agentIndex: 0,
      rootPath,
      notify: notifyRenderer,
      abortSignal: abortController.signal
    }
    const counter: SubagentCounter = { value: 0 }
    const getSystemPrompt = (): string => systemPrompt + getSessionSkillsPrompt(sessionId)

    const buildSubagentContext = (m: ModelConfig): SubagentTurnContext => ({
      agentCtx,
      model: m,
      providerKeys: settings.providerKeys,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      openaiCompatBaseUrl: settings.openaiCompatBaseUrl,
      counter,
      systemPrompt
    })

    const baseStreamParams = {
      systemPrompt,
      getSystemPrompt,
      enabledExtensionIds,
      providerKeys: settings.providerKeys,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      openaiCompatBaseUrl: settings.openaiCompatBaseUrl,
      projectRoot: rootPath,
      disabledTools,
      abortSignal: abortController.signal,
      notify: notifyRenderer
    }

    let activeModel = selectedModel
    let activeModelDisplay = modelDisplay
    let fallbackUsed = false
    let lastStreamResult: StreamResult | undefined
    let preBuiltCoreMessages: ModelMessage[] | undefined

    while (true) {
      if (abortController.signal.aborted) break

      const turnId = randomUUID()
      const collected: InjectionRecord[] = []

      const runOnce = async (m: ModelConfig): Promise<StreamResult> =>
        streamChat({
          ...baseStreamParams,
          messages,
          preBuiltCoreMessages,
          model: m,
          subagentContext: buildSubagentContext(m),
          turnId,
          sessionId,
          collectInjections: (rec) => collected.push(rec)
        })

      try {
        lastStreamResult = await runOnce(activeModel)
      } catch (err) {
        if (abortController.signal.aborted) throw err
        const isAlreadyDefault = !defaultModel || activeModel.id === defaultModel.id
        if (isAlreadyDefault || fallbackUsed) throw err

        const errorMessage = extractErrorMessage(err)
        const fallbackDisplay = defaultModel.displayName || defaultModel.modelName
        notifyRenderer(IPC.AI_STREAM_RESET, { sessionId, errorMessage, fallbackModel: fallbackDisplay })
        // Clear any modified-files recorded during the failed primary
        // attempt so the renderer only sees the fallback's writes.
        session.modifiedFiles.length = 0

        activeModel = defaultModel
        activeModelDisplay = fallbackDisplay
        fallbackUsed = true

        lastStreamResult = await runOnce(activeModel)
      }

      if (collected.length === 0) break
      if (abortController.signal.aborted) break

      // Each injection becomes a system message in the next iteration's
      // history; the renderer is also notified so it can display the
      // bordered "guided agent" cell for the user.
      const nextHistory: ModelMessage[] = [...lastStreamResult.finalMessages]
      for (const inj of collected) {
        notifyRenderer(IPC.AI_INJECTED_MESSAGE, {
          sessionId,
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
    // Snapshot before dispose — the session is about to be cleared.
    const modifiedFiles = [...session.modifiedFiles]
    return { content: lastStreamResult.content, modifiedFiles, modelDisplay: activeModelDisplay }
  } finally {
    sessionRegistry.unregister(session.sessionId)
    session.dispose()
  }
}

// Run the agent loop once and return the final string. Caller supplies the
// system prompt and messages; the host wires up settings, model selection,
// and tools (core + enabled extension tools, filtered by the user's
// disabledTools). Subagent and skill tools are intentionally excluded to
// keep one-shot runs bounded.
export async function runAgentOnce(
  messages: Message[],
  rootPath: string,
  systemPrompt: string,
): Promise<ChatResponse> {
  // One-shot background runs are not part of any user chat — give them
  // their own ephemeral session so extension tools (e.g. coding-agent
  // harnesses) treat each call as a fresh session.
  const session = new ChatSession({ sessionId: randomUUID(), rootPath })
  sessionRegistry.register(session)
  try {
    const settings = await readSettings(rootPath)
    const userMessage = messages.at(-1)?.content ?? ''
    const selectedModel = await selectModel(userMessage, settings)

    const projectSettings = await readProjectSettings(rootPath)
    const { disabledTools } = projectSettings

    const installed = await listInstalledExtensions(rootPath)
    const enabledExtensionIds = installed.filter((e) => e.enabled).map((e) => e.manifest.id)

    const streamResult = await streamChat({
      messages,
      systemPrompt,
      enabledExtensionIds,
      disabledTools,
      // One-shot background runs are deliberately bounded: no recursive
      // subagent spawning, no skill loading. Same behavior as the old
      // inline assembly that simply did not build subagent/skill tools.
      include: ['core', 'extension'],
      model: selectedModel,
      providerKeys: settings.providerKeys,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      openaiCompatBaseUrl: settings.openaiCompatBaseUrl,
      projectRoot: rootPath,
      sessionId: session.sessionId
    })

    const modelDisplay = selectedModel.displayName || selectedModel.modelName
    const modifiedFiles = [...session.modifiedFiles]
    return { content: streamResult.content, modifiedFiles, modelDisplay }
  } finally {
    sessionRegistry.unregister(session.sessionId)
    session.dispose()
  }
}

// ── Context compression / status ──

export interface ContextStatus {
  estimatedTokens: number
  contextLength: number
  percentUsed: number
  totalToolSteps: number
}

function pickActiveModel(settings: AppSettings): ModelConfig | null {
  if (settings.hostMode === 'projectrose') {
    return {
      id: 'projectrose-account',
      displayName: 'ProjectRose Account',
      provider: 'projectrose',
      modelName: 'managed',
      tags: ['account'],
    }
  }
  return settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0] ?? null
}

// Count renderer 'tool' messages — used as the second arm of the threshold
// (independent of token estimate so cloud models with huge context windows
// still surface a suggestion when tool usage piles up).
function countToolSteps(messages: Array<Record<string, unknown>>): number {
  let n = 0
  for (const m of messages) if (m.role === 'tool') n++
  return n
}

// Convert renderer messages to api shape (user/assistant/system) for token
// estimation. Mirrors renderer's buildApiMessages so the count reflects
// what the model actually sees.
function toApiShape(messages: Array<Record<string, unknown>>): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = []
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : ''
    if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content })
    } else if (m.role === 'injected') {
      const extName = typeof m.extensionName === 'string' ? m.extensionName : 'extension'
      out.push({ role: 'system', content: `[Extension ${extName}] ${content}` })
    }
  }
  return out
}

export interface ContextStatusCompression {
  compressedMessages: ApiShapeMessage[]
  compressedFromCount: number
  compressedFromRawCount: number
}

export async function getContextStatus(
  rootPath: string,
  messages: Array<Record<string, unknown>>,
  compression: ContextStatusCompression | null
): Promise<ContextStatus> {
  const settings = await readSettings(rootPath)
  const model = pickActiveModel(settings)
  const contextLength = model
    ? await getContextLength(model.provider, model.modelName, settings.ollamaBaseUrl)
    : 8192

  // Mirror renderer's substituteCompressionSnapshot: when a compression
  // snapshot is present and the prefix it claims to replace is still intact,
  // count tokens/tool-steps against the post-compression view (what the LLM
  // actually sees). Otherwise fall back to raw — same fail-open the renderer
  // uses on prefix-mismatch.
  let apiShape: Array<{ role: string; content: string }>
  let toolSteps: number
  if (compression && messages.length >= compression.compressedFromRawCount) {
    const tail = messages.slice(compression.compressedFromRawCount)
    apiShape = [
      ...compression.compressedMessages.map((m) => ({ role: m.role, content: m.content })),
      ...toApiShape(tail),
    ]
    toolSteps = countToolSteps(tail)
  } else {
    apiShape = toApiShape(messages)
    toolSteps = countToolSteps(messages)
  }

  const estimatedTokens = estimateTokens(apiShape)
  const percentUsed = contextLength > 0 ? estimatedTokens / contextLength : 0
  return {
    estimatedTokens,
    contextLength,
    percentUsed,
    totalToolSteps: toolSteps,
  }
}

export async function compressToolNoise(
  rootPath: string,
  messages: Array<Record<string, unknown>>
): Promise<CompressionResult | null> {
  const settings = await readSettings(rootPath)
  const model = pickActiveModel(settings)
  if (!model) return null
  return compressTurnsForContext(
    messages,
    model,
    settings.providerKeys,
    settings.ollamaBaseUrl,
    settings.openaiCompatBaseUrl
  )
}

export type { CompressionResult, ApiShapeMessage }
