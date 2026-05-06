import { streamText, generateText, stepCountIs, tool, extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import type { ModelMessage, ToolExecutionOptions } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ai-sdk-ollama'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import {
  handleReadFile,
  handleWriteFile,
  handleEditFile,
  handleListDirectory,
  handleGrep,
  handleRunCommand
} from './toolHandlers'
import type { ExtensionToolEntry, ExtensionToolCtx } from '../../shared/extension-types'
import type { Message } from '../../shared/roseModelTypes'
import type { ModelConfig, RouterConfig } from '../ipc/settingsHandlers'
import type { InjectionRecord } from '../../shared/extensionHooks'
import { fireThoughtHook, fireMessageHook, fireTokenHook, fireToolCallHook } from './extensionHooks'

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

// Ask-user pending promises — keyed by toolCallId
const pendingAskUser = new Map<string, (answer: string) => void>()

export function resolveAskUserQuestion(questionId: string, answer: string): void {
  pendingAskUser.get(questionId)?.(answer)
  pendingAskUser.delete(questionId)
}

export function cancelAllAskUserQuestions(): void {
  for (const resolve of pendingAskUser.values()) resolve('[cancelled]')
  pendingAskUser.clear()
}

// Screenshot tool — pending captures keyed by toolCallId. The renderer
// runs the actual MediaStream capture and posts the result back.
export type ScreenshotResult =
  | { ok: true; dataUrl: string; mode: 'screen' | 'webcam'; sourceLabel: string | null }
  | { ok: false; reason: string }

const pendingScreenshots = new Map<string, (result: ScreenshotResult) => void>()

export function resolveScreenshotRequest(requestId: string, result: ScreenshotResult): void {
  pendingScreenshots.get(requestId)?.(result)
  pendingScreenshots.delete(requestId)
}

export function cancelAllScreenshotRequests(): void {
  for (const resolve of pendingScreenshots.values()) resolve({ ok: false, reason: 'cancelled' })
  pendingScreenshots.clear()
}

export type ProviderKeys = {
  anthropic: string
  openai: string
  bedrock?: { region: string; accessKeyId: string; secretAccessKey: string }
  projectrose?: { accessToken: string; refreshToken: string; email: string; plan: string } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveModel(
  model: ModelConfig,
  providerKeys: ProviderKeys,
  ollamaBaseUrl: string,
  openaiCompatBaseUrl: string
): any {
  switch (model.provider) {
    case 'openai': {
      const provider = createOpenAI({ apiKey: providerKeys.openai || undefined })
      return provider(model.modelName || 'gpt-4o')
    }
    case 'ollama': {
      // Workaround for ai-sdk-ollama 3.8.3: it omits tool_call_id on role:"tool" messages,
      // which breaks the link to the assistant's tool_calls and confuses models like Qwen3.
      const patchedFetch: typeof fetch = async (input, init) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body)
            if (Array.isArray(body.messages)) {
              const pending: Array<{ id: string; name: string }> = []
              let mutated = false
              for (const msg of body.messages) {
                if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
                  for (const tc of msg.tool_calls) {
                    const id = tc?.id
                    const name = tc?.function?.name ?? tc?.name
                    if (typeof id === 'string' && typeof name === 'string') {
                      pending.push({ id, name })
                    }
                  }
                } else if (msg && msg.role === 'tool' && !msg.tool_call_id) {
                  const idx = pending.findIndex((p) => p.name === msg.tool_name)
                  if (idx !== -1) {
                    msg.tool_call_id = pending[idx].id
                    pending.splice(idx, 1)
                    mutated = true
                  }
                }
              }
              if (mutated) {
                init = { ...init, body: JSON.stringify(body) }
              }
            }
          } catch {
            // not JSON or unexpected shape — pass through unchanged
          }
        }
        return globalThis.fetch(input, init)
      }
      const provider = createOllama({
        baseURL: ollamaBaseUrl || 'http://localhost:11434',
        fetch: patchedFetch
      })
      return provider(model.modelName || 'llama3', { think: true })
    }
    case 'openai-compatible': {
      const provider = createOpenAI({
        apiKey: 'not-needed',
        baseURL: openaiCompatBaseUrl
      })
      return wrapLanguageModel({
        model: provider.chat(model.modelName),
        middleware: extractReasoningMiddleware({ tagName: 'think' })
      })
    }
    case 'bedrock': {
      const creds = providerKeys.bedrock
      const provider = createAmazonBedrock({
        region: creds?.region || 'us-east-1',
        accessKeyId: creds?.accessKeyId || undefined,
        secretAccessKey: creds?.secretAccessKey || undefined
      })
      return provider(model.modelName)
    }
    case 'projectrose': {
      const token = providerKeys.projectrose?.accessToken ?? ''
      const provider = createOpenAI({
        apiKey: token,
        baseURL: 'http://localhost:8000/api/openai'
      })
      return provider(model.modelName || 'managed')
    }
    case 'anthropic':
    default: {
      const provider = createAnthropic({ apiKey: providerKeys.anthropic || undefined })
      return provider(model.modelName || 'claude-sonnet-4-6')
    }
  }
}

export async function routeRequest(
  userMessage: string,
  router: RouterConfig,
  ollamaBaseUrl: string
): Promise<string> {
  const provider = createOllama({ baseURL: ollamaBaseUrl || 'http://localhost:11434' })
  const model = provider(router.modelName)
  const { text } = await generateText({
    model,
    messages: [{
      role: 'user' as const,
      content: `Categorize this request in one or two words:\n\n${userMessage}\n\nOutput only the category, nothing else.`
    }]
  })
  return text.trim().toLowerCase()
}

type ExecuteFn = (input: Record<string, unknown>, projectRoot: string, toolCtx: ExtensionToolCtx) => Promise<string>
type EmitFn = (channel: string, payload: unknown) => void

interface HookCtx {
  turnId: string
  rootPath: string
}

function wrapExecute(
  name: string,
  fn: ExecuteFn,
  projectRoot: string,
  emit: EmitFn,
  toolCtx: ExtensionToolCtx,
  hookCtx?: HookCtx
): (input: Record<string, unknown>, options: ToolExecutionOptions) => Promise<string> {
  return async (input, options) => {
    const id = options.toolCallId
    emit(IPC.AI_TOOL_CALL_START, { id, name, params: input })
    let result: string
    let error = false
    try {
      result = await fn(input, projectRoot, toolCtx)
      emit(IPC.AI_TOOL_CALL_END, { id, result, error: false })
    } catch (err) {
      result = err instanceof Error ? err.message : String(err)
      error = true
      emit(IPC.AI_TOOL_CALL_END, { id, result, error: true })
    }
    if (hookCtx) {
      await fireToolCallHook(
        { toolName: name, params: input, result, error, turnId: hookCtx.turnId },
        hookCtx.rootPath
      )
    }
    return result
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCoreTools(projectRoot: string, emit: EmitFn, toolCtx: ExtensionToolCtx, hookCtx?: HookCtx): Record<string, any> {
  return {
    read_file: tool({
      description: 'Read the contents of a file. Use project-relative paths.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the project root')
      }),
      execute: wrapExecute('read_file', handleReadFile, projectRoot, emit, toolCtx, hookCtx)
    }),
    write_file: tool({
      description: 'Write content to a file. Creates the file and any missing parent directories if they do not exist.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the project root'),
        content: z.string().describe('The full file content to write')
      }),
      execute: wrapExecute('write_file', handleWriteFile, projectRoot, emit, toolCtx, hookCtx)
    }),
    edit_file: tool({
      description: 'Replace a unique string in a file with new content. Fails if old_string is not found or appears more than once — add more surrounding context to disambiguate.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the project root'),
        old_string: z.string().describe('Exact string to find and replace. Must appear exactly once in the file.'),
        new_string: z.string().describe('String to replace old_string with')
      }),
      execute: wrapExecute('edit_file', handleEditFile, projectRoot, emit, toolCtx, hookCtx)
    }),
    list_directory: tool({
      description: 'List files and subdirectories in a directory.',
      inputSchema: z.object({
        path: z.string().describe('Directory path relative to the project root. Use "." for the root.')
      }),
      execute: wrapExecute('list_directory', handleListDirectory, projectRoot, emit, toolCtx, hookCtx)
    }),
    grep: tool({
      description: 'Search file contents for a regex pattern. Returns matching lines as file:line: text. Searches the entire project by default; narrow with path or include.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().optional().describe('Directory to search in, relative to project root (default: entire project)'),
        include: z.string().optional().describe('Comma-separated file extensions to include, e.g. ".ts,.tsx" or "*.py"'),
        case_sensitive: z.boolean().optional().describe('Case-sensitive match (default: false)')
      }),
      execute: wrapExecute('grep', handleGrep, projectRoot, emit, toolCtx, hookCtx)
    }),
    run_command: tool({
      description: 'Run a shell command in the project directory. Use for installing packages, running tests, linting, etc. Returns stdout/stderr.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute')
      }),
      execute: wrapExecute('run_command', handleRunCommand, projectRoot, emit, toolCtx, hookCtx)
    }),
    ask_user: tool({
      description: 'Ask the user a clarifying question and wait for their response before continuing. Use when you need input or a decision from the user. Provide 2–6 multiple-choice options when relevant.',
      inputSchema: z.object({
        question: z.string().describe('The question to ask the user'),
        options: z.array(z.string()).optional().describe('2–6 multiple-choice options for the user to select from')
      }),
      execute: async (input, options) => {
        const id = options.toolCallId
        return new Promise<string>((resolve) => {
          pendingAskUser.set(id, resolve)
          emit(IPC.AI_ASK_USER, { questionId: id, question: input.question, options: input.options ?? [] })
        })
      }
    }),
    screenshot: tool({
      description: 'Capture a single frame from whatever the user is currently sharing (screen, window, or camera) and attach the image to your context. Only works when the user has share-screen or camera mode enabled in the chat composer; returns an error otherwise. Useful when you need to see the user\'s current screen state or look at them through their camera.',
      inputSchema: z.object({}),
      execute: async (_input, options): Promise<string> => {
        const id = options.toolCallId
        emit(IPC.AI_TOOL_CALL_START, { id, name: 'screenshot', params: {} })
        const result = await new Promise<ScreenshotResult>((resolve) => {
          pendingScreenshots.set(id, resolve)
          emit(IPC.AI_CAPTURE_SCREENSHOT, { requestId: id })
        })
        if (!result.ok) {
          emit(IPC.AI_TOOL_CALL_END, { id, result: result.reason, error: true })
        } else {
          const summary = `Captured ${result.mode} frame${result.sourceLabel ? ` (${result.sourceLabel})` : ''}`
          emit(IPC.AI_TOOL_CALL_END, { id, result: summary, error: false })
        }
        return JSON.stringify(result)
      },
      toModelOutput: ({ output }) => {
        let parsed: ScreenshotResult
        try {
          parsed = typeof output === 'string' ? JSON.parse(output) : (output as ScreenshotResult)
        } catch {
          return { type: 'error-text', value: 'Failed to parse screenshot result.' }
        }
        if (!parsed.ok) {
          return { type: 'error-text', value: parsed.reason }
        }
        const commaIdx = parsed.dataUrl.indexOf(',')
        const base64 = commaIdx >= 0 ? parsed.dataUrl.slice(commaIdx + 1) : parsed.dataUrl
        return {
          type: 'content',
          value: [
            {
              type: 'text',
              text: `Screenshot of ${parsed.mode}${parsed.sourceLabel ? ` (${parsed.sourceLabel})` : ''}.`
            },
            { type: 'media', data: base64, mediaType: 'image/jpeg' }
          ]
        }
      }
    }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildExtensionTools(entries: ExtensionToolEntry[], projectRoot: string, emit: EmitFn, toolCtx: ExtensionToolCtx, hookCtx?: HookCtx): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {}
  for (const entry of entries) {
    const shape: Record<string, z.ZodTypeAny> = {}
    const props = entry.schema?.properties ?? {}
    for (const [key, def] of Object.entries(props as Record<string, { type: string; description?: string; enum?: string[] }>)) {
      let zodType: z.ZodTypeAny
      if (def.enum) {
        zodType = z.enum(def.enum as [string, ...string[]])
      } else if (def.type === 'number') {
        zodType = z.number()
      } else {
        zodType = z.string()
      }
      const required = (entry.schema?.required as string[] | undefined)?.includes(key) ?? false
      shape[key] = required
        ? zodType.describe(def.description ?? '')
        : zodType.optional().describe(def.description ?? '')
    }
    result[entry.name] = tool({
      description: entry.description,
      inputSchema: z.object(shape),
      execute: wrapExecute(entry.name, entry.execute, projectRoot, emit, toolCtx, hookCtx)
    })
  }
  return result
}

export interface StreamResult {
  content: string
  inputTokens: number
  outputTokens: number
  // Full conversation including the assistant response(s) and any tool messages
  // produced during this streamChat call. Used by aiService.chat to extend the
  // history when an extension hook injects a follow-up message.
  finalMessages: ModelMessage[]
}

function isXmlParseError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('xml syntax error') || lower.includes('expected element type')
}

function toModelMessage(m: Message): ModelMessage {
  if (m.role === 'system') return { role: 'system', content: m.content }
  if (m.role === 'assistant') return { role: 'assistant', content: m.content }
  const atts = m.attachments ?? []
  if (atts.length === 0) return { role: 'user', content: m.content }
  return {
    role: 'user',
    content: [
      { type: 'text', text: m.content },
      ...atts.map((a) => ({ type: 'image' as const, image: a.dataUrl, mediaType: a.mimeType }))
    ]
  }
}

export async function streamChat(params: {
  messages: Message[]
  systemPrompt: string
  extensionTools?: ExtensionToolEntry[]
  model: ModelConfig
  providerKeys: ProviderKeys
  ollamaBaseUrl: string
  openaiCompatBaseUrl: string
  projectRoot: string
  disabledCoreTools?: string[]
  abortSignal?: AbortSignal
  // Optional notify override — defaults to notifyRenderer (main agent).
  // Pass `() => {}` for subagents that should not emit IPC events.
  notify?: EmitFn
  // Extra tools merged into the tool set after core/extension/python tools are built.
  // Useful for injecting agent-command tools (create_subagents, explore, etc.).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraTools?: Record<string, any>
  // Called fresh before each step — allows dynamic system prompt updates (e.g. loaded skills).
  getSystemPrompt?: () => string
  // When set, chat hooks fire at segment boundaries and after tool calls.
  // Only the user-visible main chat passes this; subagents and one-shot
  // background runs leave it undefined to keep hooks scoped to the main chat.
  turnId?: string
  // Host chat session id forwarded to extension tool execute() as toolCtx.sessionId.
  // Required so extensions can scope state (e.g. CLI session resume) per chat.
  sessionId: string
  collectInjections?: (rec: InjectionRecord) => void
  // Escape hatch for the auto-injection loop: when set, skip the Message[] →
  // ModelMessage[] conversion and use these directly. Lets the loop preserve
  // full assistant tool-call structure across iterations (Message[] is lossy).
  preBuiltCoreMessages?: ModelMessage[]
}): Promise<StreamResult> {
  const { messages, systemPrompt, extensionTools, model: modelConfig, providerKeys, ollamaBaseUrl, openaiCompatBaseUrl, projectRoot, disabledCoreTools, abortSignal } = params
  const emit: EmitFn = params.notify ?? notifyRenderer
  const hookCtx: HookCtx | undefined = params.turnId ? { turnId: params.turnId, rootPath: projectRoot } : undefined
  const toolCtx: ExtensionToolCtx = { sessionId: params.sessionId, turnId: params.turnId }
  const model = resolveModel(modelConfig, providerKeys, ollamaBaseUrl, openaiCompatBaseUrl)
  const tools = {
    ...buildCoreTools(projectRoot, emit, toolCtx, hookCtx),
    ...buildExtensionTools(extensionTools ?? [], projectRoot, emit, toolCtx, hookCtx),
    ...(params.extraTools ?? {})
  }
  for (const name of disabledCoreTools ?? []) delete tools[name]

  let coreMessages: ModelMessage[] = params.preBuiltCoreMessages
    ? [...params.preBuiltCoreMessages]
    : messages.map((m) => toModelMessage(m))

  const fireBoundary = async (kind: 'thought' | 'message', content: string): Promise<void> => {
    if (!hookCtx || !params.collectInjections || content.length === 0) return
    const rec = kind === 'thought'
      ? await fireThoughtHook(content, hookCtx.turnId, hookCtx.rootPath)
      : await fireMessageHook(content, hookCtx.turnId, hookCtx.rootPath)
    if (rec) params.collectInjections(rec)
  }

  let accumulatedText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let stepNum = 0; stepNum < 100; stepNum++) {
    let hadTools = false
    let finishReason: string | undefined

    // Inner retry loop — retries up to 2 times on XML parse errors from models like QWEN
    // that use XML-based tool calling and occasionally produce malformed output.
    for (let xmlRetries = 0; xmlRetries <= 2; xmlRetries++) {
      const result = streamText({
        model,
        system: params.getSystemPrompt?.() ?? systemPrompt,
        messages: coreMessages,
        tools,
        stopWhen: stepCountIs(1),
        abortSignal
      })

      let stepError: Error | null = null
      // Per-step segment buffers. A "segment" is a contiguous run of text-delta
      // or reasoning-delta chunks; the boundary is detected when the chunk type
      // changes. At each boundary we fire on_thought / on_message hooks with
      // the buffered content. Reset on every retry so a partial buffered
      // segment from a failed attempt does not leak into the retry.
      let textBuffer = ''
      let thinkingBuffer = ''

      try {
        for await (const chunk of result.fullStream) {
          // Boundary detection: flush buffers when transitioning to a different
          // chunk type. Tool-call chunks, finish chunks, etc. all close out
          // any in-flight text/thinking segments so hooks see contiguous content.
          if (chunk.type !== 'text-delta' && textBuffer.length > 0) {
            const flushed = textBuffer
            textBuffer = ''
            await fireBoundary('message', flushed)
          }
          if (chunk.type !== 'reasoning-delta' && thinkingBuffer.length > 0) {
            const flushed = thinkingBuffer
            thinkingBuffer = ''
            await fireBoundary('thought', flushed)
          }

          switch (chunk.type) {
            case 'text-delta':
              if (chunk.text) {
                accumulatedText += chunk.text
                textBuffer += chunk.text
                emit(IPC.AI_TOKEN, { token: chunk.text })
                // Notify on_token hooks. Voided so a slow handler never stalls
                // streaming — handlers must self-throttle if they need to.
                if (hookCtx) void fireTokenHook(chunk.text, hookCtx.turnId, hookCtx.rootPath)
              }
              break
            case 'reasoning-delta':
              if (chunk.text) {
                thinkingBuffer += chunk.text
                emit(IPC.AI_THINKING, { content: chunk.text })
              }
              break
            case 'finish':
              if (chunk.totalUsage) {
                inputTokens += chunk.totalUsage.inputTokens ?? 0
                outputTokens += chunk.totalUsage.outputTokens ?? 0
              }
              break
            case 'error': {
              const e = chunk.error
              const errMsg = e instanceof Error ? e.message : (
                typeof e === 'object' && e !== null && 'message' in e
                  ? String((e as { message: unknown }).message)
                  : JSON.stringify(e)
              )
              if (e instanceof Error) throw e
              throw new Error(errMsg)
            }
          }
        }

        // End-of-stream flush in case the stream ended on a text/reasoning
        // delta without a separate boundary chunk.
        if (textBuffer.length > 0) {
          const flushed = textBuffer
          textBuffer = ''
          await fireBoundary('message', flushed)
        }
        if (thinkingBuffer.length > 0) {
          const flushed = thinkingBuffer
          thinkingBuffer = ''
          await fireBoundary('thought', flushed)
        }

        const steps = await result.steps
        const resp = await result.response
        const lastStep = steps.at(-1)
        hadTools = (lastStep?.toolCalls?.length ?? 0) > 0
        finishReason = lastStep?.finishReason
        coreMessages = [...coreMessages, ...resp.messages]
      } catch (err) {
        stepError = err instanceof Error ? err : new Error(String(err))
      }

      if (!stepError) break  // step succeeded — exit retry loop
      if (isXmlParseError(stepError.message) && xmlRetries < 2) continue
      throw stepError
    }

    if (!hadTools || finishReason === 'length' || finishReason === 'content-filter') break
  }

  return { content: accumulatedText, inputTokens, outputTokens, finalMessages: coreMessages }
}


export async function compressMessages(
  messages: Message[],
  modelConfig: ModelConfig,
  providerKeys: ProviderKeys,
  ollamaBaseUrl: string,
  openaiCompatBaseUrl: string
): Promise<Message[]> {
  if (messages.length <= 40) return messages

  const half = Math.floor(messages.length / 2)
  const firstHalf = messages.slice(0, half)
  const secondHalf = messages.slice(half)

  const model = resolveModel(modelConfig, providerKeys, ollamaBaseUrl, openaiCompatBaseUrl)
  const conversationText = firstHalf
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const { text } = await generateText({
    model,
    messages: [{
      role: 'user' as const,
      content: `Summarize the following conversation concisely, preserving key context and decisions:\n\n${conversationText}`
    }]
  })

  return [
    { role: 'user', content: `Previous conversation summary:\n${text}` },
    ...secondHalf
  ]
}
