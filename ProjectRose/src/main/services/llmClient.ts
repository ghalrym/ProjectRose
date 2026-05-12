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
  handleRunCommand,
  handleSearchWeb
} from './toolHandlers'
import type { ExtensionToolEntry, ExtensionToolCtx } from '../../shared/extension-types'
import type { Message } from '../../shared/roseModelTypes'
import type { ModelConfig, RouterConfig } from '../ipc/settingsHandlers'
import type { InjectionRecord } from '../../shared/extensionHooks'
import { fireThoughtHook, fireMessageHook, fireTokenHook, fireToolCallHook } from './extensionHooks'
import { loadSession } from '../lib/session'
import { WEB_BASE_URL } from '../lib/webConfig'

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
}

// SSE chunk patcher for the projectrose Responses endpoint. Tracks the
// output_index assigned to each item by response.output_item.added events,
// then back-fills the field on response.function_call_arguments.delta events
// (which the backend currently emits without it). Also injects the required
// status: "completed" on response.output_item.done events for function_call
// items. Returns the line unchanged if it isn't a data line we know about.
function patchProjectroseSseLine(
  line: string,
  itemIdToOutputIndex: Map<string, number>
): string {
  const trailing = line.match(/\r?\n$/)?.[0] ?? ''
  const content = trailing ? line.slice(0, -trailing.length) : line
  if (!content.startsWith('data:')) return line

  const jsonText = content.slice('data:'.length).replace(/^ /, '')
  if (jsonText === '' || jsonText === '[DONE]') return line

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return line
  }

  if (
    obj.type === 'response.output_item.added' &&
    typeof obj.output_index === 'number'
  ) {
    const item = obj.item as { id?: unknown } | undefined
    if (item && typeof item.id === 'string') {
      itemIdToOutputIndex.set(item.id, obj.output_index)
    }
  }

  let mutated = false
  if (
    obj.type === 'response.function_call_arguments.delta' &&
    obj.output_index === undefined &&
    typeof obj.item_id === 'string'
  ) {
    const idx = itemIdToOutputIndex.get(obj.item_id)
    if (typeof idx === 'number') {
      obj.output_index = idx
      mutated = true
    }
  }

  if (obj.type === 'response.output_item.done') {
    const item = obj.item as { type?: unknown; status?: unknown } | undefined
    if (item && item.type === 'function_call' && item.status === undefined) {
      item.status = 'completed'
      mutated = true
    }
  }

  if (!mutated) return line
  return `data: ${JSON.stringify(obj)}${trailing}`
}

const patchProjectroseResponsesFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init)
  if (!response.body) return response
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) return response

  const itemIdToOutputIndex = new Map<string, number>()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx + 1)
        buffer = buffer.slice(newlineIdx + 1)
        controller.enqueue(encoder.encode(patchProjectroseSseLine(line, itemIdToOutputIndex)))
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(patchProjectroseSseLine(buffer, itemIdToOutputIndex)))
        buffer = ''
      }
    }
  })

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveModel(
  model: ModelConfig,
  providerKeys: ProviderKeys,
  ollamaBaseUrl: string,
  openaiCompatBaseUrl: string
): Promise<any> {
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
      const session = await loadSession()
      const token = session?.token ?? ''
      const provider = createOpenAI({
        apiKey: token,
        baseURL: `${WEB_BASE_URL}/api/openai`,
        // Workaround for the managed Responses endpoint: its SSE stream omits
        // two fields that @ai-sdk/openai 3.x strictly validates, so tool calls
        // never reach the SDK's `tool-call` emit path:
        //   1. `output_index` on response.function_call_arguments.delta
        //   2. `status: "completed"` on response.output_item.done items of
        //       type function_call
        // Until the backend is fixed, rewrite each SSE event on the way in
        // and fill the missing fields before the SDK parses the chunk.
        fetch: patchProjectroseResponsesFetch
      })
      // Explicit .responses() — hits /api/openai/responses. The bare provider()
      // call resolves to the same thing in @ai-sdk/openai 3.x but explicit
      // beats implicit, and reasoning streams (response.reasoning_summary_text.delta)
      // only flow through the Responses transport.
      return provider.responses(model.modelName || 'managed')
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
    search_web: tool({
      description: 'Search the web for up-to-date information. Use when the user asks about current events, documentation, libraries, or anything that may have changed since the model was trained. Returns the search API response as JSON containing result titles, URLs, and snippets.',
      inputSchema: z.object({
        query: z.string().describe('The search query — natural language is fine'),
        numResults: z.number().optional().describe('Maximum number of results to return (server picks a default if omitted)')
      }),
      execute: wrapExecute('search_web', handleSearchWeb, projectRoot, emit, toolCtx, hookCtx)
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
  const model = await resolveModel(modelConfig, providerKeys, ollamaBaseUrl, openaiCompatBaseUrl)
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
  // Some upstream models prefix the first message delta with stray newlines
  // (e.g. minimax). Swallow leading whitespace until the first real character.
  let textStarted = false

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
                let token = chunk.text
                if (!textStarted) {
                  token = token.replace(/^\s+/, '')
                  if (token.length === 0) break
                  textStarted = true
                }
                accumulatedText += token
                textBuffer += token
                emit(IPC.AI_TOKEN, { token })
                // Notify on_token hooks. Voided so a slow handler never stalls
                // streaming — handlers must self-throttle if they need to.
                if (hookCtx) void fireTokenHook(token, hookCtx.turnId, hookCtx.rootPath)
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


// Renderer-shaped message: structural subset of the renderer's ChatMessage union.
// Defined here as Record<string, unknown> to avoid an import cycle with the
// renderer module — fields are pulled out by name with runtime checks.
type RendererMessage = Record<string, unknown>

// Output shape sent to the LLM. Matches what the renderer's buildApiMessages
// produces from settled renderer messages.
export interface ApiShapeMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// Number of trailing turns left untouched by compression. A "turn" starts at a
// user message and ends just before the next user message (or end of list).
// Holding back the recent two means the model still sees the active back-and-forth
// verbatim while older history collapses into summaries.
const KEEP_RECENT_TURNS = 2

interface Turn {
  // Indices into the input renderer-message array, inclusive.
  start: number
  end: number
  // Indices into the api-shape view (post-filter to user/assistant/injected).
  apiStart: number
  apiEnd: number
}

function isApiShape(role: unknown): role is 'user' | 'assistant' | 'injected' {
  return role === 'user' || role === 'assistant' || role === 'injected'
}

function rendererToApi(m: RendererMessage): ApiShapeMessage | null {
  const role = m.role
  const content = typeof m.content === 'string' ? m.content : ''
  if (role === 'user') return { role: 'user', content }
  if (role === 'assistant') return { role: 'assistant', content }
  if (role === 'injected') {
    const extName = typeof m.extensionName === 'string' ? m.extensionName : 'extension'
    return { role: 'system', content: `[Extension ${extName}] ${content}` }
  }
  return null
}

// Walk renderer messages and produce one Turn per user message. The first turn
// covers any leading non-user messages too (shouldn't normally happen, but if
// the session starts with system/injected content it still gets grouped).
function splitIntoTurns(messages: RendererMessage[]): Turn[] {
  const turns: Turn[] = []
  let currentStart = 0
  let currentApiStart = 0
  let apiIdx = 0
  let started = false

  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role
    if (role === 'user') {
      if (started) {
        turns.push({
          start: currentStart,
          end: i - 1,
          apiStart: currentApiStart,
          apiEnd: apiIdx - 1,
        })
      }
      currentStart = i
      currentApiStart = apiIdx
      started = true
    }
    if (isApiShape(role)) apiIdx++
  }
  if (started) {
    turns.push({
      start: currentStart,
      end: messages.length - 1,
      apiStart: currentApiStart,
      apiEnd: apiIdx - 1,
    })
  }
  return turns
}

// Build a compact text representation of one old turn that the summarizer can
// digest. Mentions tools used (with success/error) so the summary can name them
// even though tool messages never round-trip to the LLM in normal chat.
function describeTurnForSummary(messages: RendererMessage[], turn: Turn): string {
  const lines: string[] = []
  for (let i = turn.start; i <= turn.end; i++) {
    const m = messages[i]
    const role = m.role
    const content = typeof m.content === 'string' ? m.content : ''
    if (role === 'user') {
      lines.push(`USER: ${content}`)
    } else if (role === 'assistant') {
      if (content.trim().length > 0) lines.push(`ASSISTANT: ${content}`)
    } else if (role === 'tool') {
      const name = typeof m.name === 'string' ? m.name : 'tool'
      const error = m.error === true
      const result = typeof m.result === 'string' ? m.result : ''
      const snippet = result.length > 200 ? result.slice(0, 200) + '…' : result
      lines.push(`TOOL ${name}${error ? ' (error)' : ''}: ${snippet}`)
    } else if (role === 'ask_user') {
      const q = typeof m.question === 'string' ? m.question : ''
      const a = typeof m.answer === 'string' ? m.answer : ''
      lines.push(`ASK_USER: ${q} → ${a}`)
    } else if (role === 'injected') {
      const extName = typeof m.extensionName === 'string' ? m.extensionName : 'extension'
      lines.push(`INJECTED [${extName}]: ${content}`)
    }
  }
  return lines.join('\n')
}

export interface CompressionResult {
  // Replacement view for the first `compressedFromCount` items of the
  // renderer's api-shape messages. The renderer substitutes them in before
  // sending the next chat call.
  compressedMessages: ApiShapeMessage[]
  // Number of original api-shape messages this view replaces. Used by the
  // renderer to slice out the substituted prefix.
  compressedFromCount: number
  // Raw renderer-message counterpart of compressedFromCount. Includes the
  // kept-verbatim recent-turn raw messages, since those are also embedded in
  // compressedMessages. Used by status reporting to count tool steps only in
  // the post-compression tail.
  compressedFromRawCount: number
}

export async function compressTurnsForContext(
  messages: RendererMessage[],
  modelConfig: ModelConfig,
  providerKeys: ProviderKeys,
  ollamaBaseUrl: string,
  openaiCompatBaseUrl: string
): Promise<CompressionResult | null> {
  const turns = splitIntoTurns(messages)
  if (turns.length <= KEEP_RECENT_TURNS) return null

  const oldTurns = turns.slice(0, turns.length - KEEP_RECENT_TURNS)
  const recentTurns = turns.slice(turns.length - KEEP_RECENT_TURNS)

  const oldDescriptions = oldTurns
    .map((t, idx) => `### Turn ${idx + 1}\n${describeTurnForSummary(messages, t)}`)
    .join('\n\n')

  const model = await resolveModel(modelConfig, providerKeys, ollamaBaseUrl, openaiCompatBaseUrl)
  const summaryPrompt = `You are compressing the older portion of a coding-assistant chat session to keep the model's context focused. For each turn below, write ONE short sentence (max 25 words) that captures: what the user asked, which tools the assistant used, and the outcome. Output as a numbered list with no preamble or trailing remarks.

${oldDescriptions}`

  const { text: summary } = await generateText({
    model,
    messages: [{ role: 'user' as const, content: summaryPrompt }]
  })

  const summaryBlock: ApiShapeMessage = {
    role: 'system',
    content: `Summary of earlier turns in this session (older history compressed to save context):\n${summary.trim()}`
  }

  // Append the recent turns verbatim, in api shape, after the summary.
  const recentApi: ApiShapeMessage[] = []
  for (const t of recentTurns) {
    for (let i = t.start; i <= t.end; i++) {
      const api = rendererToApi(messages[i])
      if (api) recentApi.push(api)
    }
  }

  // compressedMessages already contains the recent turns verbatim, so the
  // substitution covers ALL api-shape messages present at compression time.
  // The renderer slices its current apiMessages by this count and appends any
  // newer ones produced after compression.
  const compressedFromCount = recentTurns[recentTurns.length - 1].apiEnd + 1
  const compressedFromRawCount = recentTurns[recentTurns.length - 1].end + 1

  return {
    compressedMessages: [summaryBlock, ...recentApi],
    compressedFromCount,
    compressedFromRawCount,
  }
}
