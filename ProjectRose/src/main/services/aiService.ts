import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { streamChat, compressTurnsForContext } from './llmClient'
import type { ApiShapeMessage, CompressionResult } from './llmClient'
import { getContextLength } from './contextLengthRegistry'
import { estimateTokens } from './tokenCounter'
import { readSettings } from '../ipc/settingsHandlers'
import type { AppSettings } from '../ipc/settingsHandlers'
import { readProjectSettings } from '../ipc/projectSettingsHandlers'
import { listInstalledExtensions } from '../ipc/extensionHandlers'
import type { Message } from '../../shared/roseModelTypes'
import { ChatSession } from './chatSession'
import type { ChatResponse } from './chatSession'
import { sessionRegistry } from './sessionRegistry'
import { selectModel, pickActiveModel } from './modelSelection'

export type { ChatResponse }

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ── Public API ──

/**
 * Run a user chat turn for the given session id. Constructs a
 * `ChatSession`, registers it so IPC handlers can route ask-user /
 * screenshot / cancel back to it, and delegates the actual work to
 * `session.run()`. The `finally` block both unregisters and disposes so
 * the registry never carries stale handles past a completed turn.
 */
export async function chat(messages: Message[], rootPath: string, sessionId: string): Promise<ChatResponse> {
  const session = new ChatSession({ sessionId, rootPath })
  sessionRegistry.register(session)
  try {
    return await session.run({ messages, notify: notifyRenderer })
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
      sessionId: session.sessionId,
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
  const settings: AppSettings = await readSettings(rootPath)
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
