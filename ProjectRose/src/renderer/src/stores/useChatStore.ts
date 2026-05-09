import { create } from 'zustand'
import type { MessageAttachment } from '@shared/roseModelTypes'
import { useProjectStore } from './useProjectStore'
import { useSettingsStore } from './useSettingsStore'
import { useScreenWebcamShare } from '../hooks/useScreenWebcamShare'

let msgCounter = 0

interface BaseMessage {
  id: string
  timestamp: number
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  content: string
  attachments?: MessageAttachment[]
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  content: string
  streaming?: boolean
  isError?: boolean
  modelDisplay?: string
  fallbackNotice?: string
}

export interface ToolMessage extends BaseMessage {
  role: 'tool'
  toolId: string
  name: string
  params: Record<string, unknown>
  result: string | null
  error: boolean
  pending: boolean
}

export interface ThinkingMessage extends BaseMessage {
  role: 'thinking'
  content: string
  streaming?: boolean
}

export interface AskUserMessage extends BaseMessage {
  role: 'ask_user'
  questionId: string
  question: string
  options: string[]
  answer: string | null
}

export interface InjectedMessage extends BaseMessage {
  role: 'injected'
  content: string
  extensionId: string
  extensionName: string
  extensionIcon?: string
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage | ThinkingMessage | AskUserMessage | InjectedMessage

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export type CompressedApiMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export interface ContextStatus {
  estimatedTokens: number
  contextLength: number
  percentUsed: number
  totalToolSteps: number
}

// Hybrid trigger: token-percent crossing comes from settings (per-user
// configurable, defaults to 0.70); tool-step count is fixed at 50 because
// it's a property of the agentic loop budget rather than the model.
const TOOL_STEP_THRESHOLD = 50
// Hysteresis after dismiss: re-show only once usage has grown by 10pp OR by
// another 25 tool steps. Prevents the toast from re-appearing every turn.
const REDISPLAY_PCT_DELTA = 0.10
const REDISPLAY_TOOL_DELTA = 25

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  isRecording: boolean
  inputValue: string
  currentSessionId: string | null
  sessions: SessionMeta[]
  searchQuery: string
  assistantPlaceholderId: string | null
  thinkingPlaceholderId: string | null
  pendingModelDisplay: string | null

  // Per-session compression snapshot — replaces the leading `compressedFromCount`
  // api-shape messages on every send until cleared or replaced. Persisted in
  // session JSON so it survives restarts.
  compressedMessages: CompressedApiMessage[] | null
  compressedFromCount: number | null
  compressedAt: number | null

  contextStatus: ContextStatus | null
  // Snapshot of {percentUsed, totalToolSteps} at dismiss time. The toast
  // re-appears only after the live values exceed this snapshot by the
  // REDISPLAY_* deltas — avoids nagging on every subsequent turn.
  compressionToastDismissed: { percentUsed: number; totalToolSteps: number } | null
  isCompressing: boolean

  setInputValue: (value: string) => void
  setIsRecording: (v: boolean) => void
  setSearchQuery: (q: string) => void
  sendMessage: () => Promise<void>
  clearMessages: () => void
  appendToolStart: (data: { id: string; name: string; params: Record<string, unknown> }) => void
  resolveToolEnd: (data: { id: string; result: string; error: boolean }) => void
  appendThinking: (data: { content: string }) => void
  appendToken: (data: { token: string }) => void
  appendAskUser: (data: { questionId: string; question: string; options: string[] }) => void
  answerAskUser: (questionId: string, answer: string) => Promise<void>
  appendInjectedMessage: (data: { extensionId: string; extensionName: string; extensionIcon?: string; content: string }) => void
  cancelGeneration: () => Promise<void>

  refreshContextStatus: (rootPath: string) => Promise<void>
  compressNow: (rootPath: string) => Promise<void>
  dismissCompressionToast: () => void

  loadSessions: (rootPath: string) => Promise<void>
  switchSession: (rootPath: string, sessionId: string) => Promise<void>
  newSession: () => void
  renameSession: (rootPath: string, sessionId: string, title: string) => Promise<void>
  deleteSession: (rootPath: string, sessionId: string) => Promise<void>
}

function generateId(): string {
  return crypto.randomUUID()
}

interface PersistOpts {
  compressedMessages?: CompressedApiMessage[] | null
  compressedFromCount?: number | null
  compressedAt?: number | null
}

function persistSession(rootPath: string, sessionId: string, title: string, createdAt: number, messages: ChatMessage[], opts: PersistOpts = {}): void {
  const payload: Parameters<typeof window.api.session.save>[1] = {
    id: sessionId,
    title,
    createdAt,
    updatedAt: Date.now(),
    messages: messages as unknown[]
  }
  if (opts.compressedMessages && opts.compressedFromCount != null && opts.compressedAt != null) {
    payload.compressedMessages = opts.compressedMessages
    payload.compressedFromCount = opts.compressedFromCount
    payload.compressedAt = opts.compressedAt
  }
  window.api.session.save(rootPath, payload).catch(() => { /* persistence failures are non-fatal */ })
}

// Returns true if context status crosses either threshold AND the user hasn't
// already dismissed at this level (with hysteresis). `tokenThresholdPct` is the
// fraction of model context (0..1) at which to suggest compression; comes from
// AppSettings.compressionThresholdPct so users can tune it.
export function shouldShowCompressionToast(
  status: ContextStatus | null,
  dismissed: { percentUsed: number; totalToolSteps: number } | null,
  tokenThresholdPct: number
): boolean {
  if (!status) return false
  const clampedThreshold = Math.min(1, Math.max(0.05, tokenThresholdPct))
  const overToken = status.percentUsed >= clampedThreshold
  const overSteps = status.totalToolSteps >= TOOL_STEP_THRESHOLD
  if (!overToken && !overSteps) return false
  if (!dismissed) return true
  return (
    status.percentUsed - dismissed.percentUsed >= REDISPLAY_PCT_DELTA ||
    status.totalToolSteps - dismissed.totalToolSteps >= REDISPLAY_TOOL_DELTA
  )
}

function insertBefore(messages: ChatMessage[], targetId: string, insert: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === targetId)
  if (idx < 0) return [...messages, insert]
  return [...messages.slice(0, idx), insert, ...messages.slice(idx)]
}

function sanitizeLoadedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if ((m.role === 'assistant' || m.role === 'thinking') && (m as AssistantMessage).streaming) {
      return { ...m, streaming: false, content: (m as AssistantMessage).content || '[interrupted]' }
    }
    if (m.role === 'ask_user' && (m as AskUserMessage).answer === null) {
      return { ...m, answer: '[interrupted]' }
    }
    return m
  })
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  isLoading: false,
  isRecording: false,
  inputValue: '',
  currentSessionId: null,
  sessions: [],
  searchQuery: '',
  assistantPlaceholderId: null,
  thinkingPlaceholderId: null,
  pendingModelDisplay: null,
  compressedMessages: null,
  compressedFromCount: null,
  compressedAt: null,
  contextStatus: null,
  compressionToastDismissed: null,
  isCompressing: false,

  setInputValue: (value) => set({ inputValue: value }),
  setIsRecording: (v) => set({ isRecording: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  appendToken: (data) => {
    set((s) => {
      if (s.assistantPlaceholderId) {
        return {
          messages: s.messages.map((m) =>
            m.id === s.assistantPlaceholderId && m.role === 'assistant'
              ? { ...m, content: m.content + data.token }
              : m
          )
        }
      }
      // No active assistant segment — start a new one after whatever is currently last
      const id = `msg-${++msgCounter}`
      const msg: AssistantMessage = {
        id,
        role: 'assistant',
        content: data.token,
        timestamp: Date.now(),
        streaming: true,
        modelDisplay: s.pendingModelDisplay ?? undefined
      }
      return {
        messages: [...s.messages, msg],
        assistantPlaceholderId: id
      }
    })
  },

  appendToolStart: (data) => {
    const toolMsg: ToolMessage = {
      id: `msg-${++msgCounter}`,
      role: 'tool',
      timestamp: Date.now(),
      toolId: data.id,
      name: data.name,
      params: data.params,
      result: null,
      error: false,
      pending: true
    }
    set((s) => {
      // Seal any in-progress thinking and assistant segments so they stand alone
      const messages = s.messages.map((m) => {
        if (m.id === s.thinkingPlaceholderId && m.role === 'thinking') return { ...m, streaming: false }
        if (m.id === s.assistantPlaceholderId && m.role === 'assistant') return { ...m, streaming: false }
        return m
      })
      return {
        messages: [...messages, toolMsg],
        thinkingPlaceholderId: null,
        assistantPlaceholderId: null
      }
    })
  },

  resolveToolEnd: (data) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.role === 'tool' && m.toolId === data.id
          ? { ...m, result: data.result, error: data.error, pending: false }
          : m
      )
    }))
  },

  appendAskUser: (data) => {
    set((s) => {
      const messages = s.messages.map((m) => {
        if (m.id === s.thinkingPlaceholderId && m.role === 'thinking') return { ...m, streaming: false }
        if (m.id === s.assistantPlaceholderId && m.role === 'assistant') return { ...m, streaming: false }
        return m
      })
      const msg: AskUserMessage = {
        id: `msg-${++msgCounter}`,
        role: 'ask_user',
        timestamp: Date.now(),
        questionId: data.questionId,
        question: data.question,
        options: data.options,
        answer: null
      }
      return {
        messages: [...messages, msg],
        thinkingPlaceholderId: null,
        assistantPlaceholderId: null
      }
    })
  },

  answerAskUser: async (questionId, answer) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.role === 'ask_user' && (m as AskUserMessage).questionId === questionId
          ? { ...m, answer }
          : m
      )
    }))
    await window.api.aiAskUserResponse(questionId, answer)
  },

  appendInjectedMessage: (data) => {
    set((s) => {
      // Seal any in-progress streaming segments so the new turn (which the
      // injection will trigger in main process) starts fresh segments.
      const messages = s.messages.map((m) => {
        if (m.id === s.thinkingPlaceholderId && m.role === 'thinking') return { ...m, streaming: false }
        if (m.id === s.assistantPlaceholderId && m.role === 'assistant') return { ...m, streaming: false }
        return m
      })
      const msg: InjectedMessage = {
        id: `msg-${++msgCounter}`,
        role: 'injected',
        timestamp: Date.now(),
        content: data.content,
        extensionId: data.extensionId,
        extensionName: data.extensionName,
        extensionIcon: data.extensionIcon
      }
      return {
        messages: [...messages, msg],
        thinkingPlaceholderId: null,
        assistantPlaceholderId: null
      }
    })
  },

  cancelGeneration: async () => {
    await window.api.aiCancelGeneration()
  },

  appendThinking: (data) => {
    set((s) => {
      if (s.thinkingPlaceholderId) {
        return {
          messages: s.messages.map((m) =>
            m.id === s.thinkingPlaceholderId && m.role === 'thinking'
              ? { ...m, content: m.content + data.content }
              : m
          )
        }
      }
      const thinkingId = `msg-${++msgCounter}`
      const msg: ThinkingMessage = {
        id: thinkingId,
        role: 'thinking',
        timestamp: Date.now(),
        content: data.content,
        streaming: true
      }
      return {
        messages: s.assistantPlaceholderId
          ? insertBefore(s.messages, s.assistantPlaceholderId, msg)
          : [...s.messages, msg],
        thinkingPlaceholderId: thinkingId
      }
    })
  },

  sendMessage: async () => {
    const { inputValue, isLoading } = get()
    const trimmed = inputValue.trim()
    if (!trimmed || isLoading) return

    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return

    // Snapshot API messages before adding new messages to state
    const includeThinking = useSettingsStore.getState().includeThinkingInContext
    const settled = get().messages.filter((m) => !(m as AssistantMessage).streaming && !(m as ThinkingMessage).streaming)
    type ApiMessage = { role: 'user' | 'assistant' | 'system'; content: string; attachments?: MessageAttachment[] }
    let apiMessages: ApiMessage[]
    if (includeThinking) {
      apiMessages = []
      let pendingThinking = ''
      for (const m of settled) {
        if (m.role === 'thinking') {
          pendingThinking += (pendingThinking ? '\n\n' : '') + m.content
        } else if (m.role === 'user') {
          pendingThinking = ''
          apiMessages.push({ role: 'user', content: m.content, attachments: (m as UserMessage).attachments })
        } else if (m.role === 'assistant') {
          const content = pendingThinking
            ? `<thinking>\n${pendingThinking}\n</thinking>\n\n${m.content}`
            : m.content
          pendingThinking = ''
          apiMessages.push({ role: 'assistant', content })
        } else if (m.role === 'injected') {
          pendingThinking = ''
          apiMessages.push({ role: 'system', content: `[Extension ${(m as InjectedMessage).extensionName}] ${(m as InjectedMessage).content}` })
        }
      }
    } else {
      apiMessages = settled
        .filter((m): m is UserMessage | AssistantMessage | InjectedMessage => m.role === 'user' || m.role === 'assistant' || m.role === 'injected')
        .map((m): ApiMessage => {
          if (m.role === 'injected') {
            return { role: 'system' as const, content: `[Extension ${m.extensionName}] ${m.content}` }
          }
          if (m.role === 'user') {
            return { role: 'user', content: m.content, attachments: m.attachments }
          }
          return { role: 'assistant', content: m.content }
        })
    }

    // If a compressed snapshot is present and the prefix it claims to replace
    // is still all there, substitute it in. Anything appended after compression
    // (newer turns) flows through verbatim.
    const { compressedMessages, compressedFromCount } = get()
    if (compressedMessages && compressedFromCount != null && apiMessages.length >= compressedFromCount) {
      const tail = apiMessages.slice(compressedFromCount)
      apiMessages = [
        ...compressedMessages.map((m): ApiMessage => ({ role: m.role, content: m.content })),
        ...tail,
      ]
    }

    const frame = await useScreenWebcamShare.getState().captureFrame()

    const userMsg: UserMessage = {
      id: `msg-${++msgCounter}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      ...(frame ? { attachments: [frame] } : {})
    }

    // Create session on first message
    let sessionId = get().currentSessionId
    let sessionCreatedAt = Date.now()
    const sessionTitle = trimmed.slice(0, 50)
    const isNewSession = !sessionId

    if (isNewSession) {
      sessionId = generateId()
      set((s) => ({
        currentSessionId: sessionId,
        sessions: [{ id: sessionId!, title: sessionTitle, createdAt: sessionCreatedAt, updatedAt: sessionCreatedAt }, ...s.sessions]
      }))
    }

    const session = get().sessions.find((s) => s.id === sessionId)
    const createdAt = session?.createdAt ?? sessionCreatedAt
    const title = session?.title ?? sessionTitle

    // No upfront assistant placeholder — segments are created dynamically as tokens arrive
    set((s) => ({
      messages: [...s.messages, userMsg],
      inputValue: '',
      isLoading: true,
      assistantPlaceholderId: null,
      thinkingPlaceholderId: null,
      pendingModelDisplay: null
    }))

    const persistFromState = (): void => {
      const s = get()
      persistSession(rootPath, sessionId!, title, createdAt, s.messages, {
        compressedMessages: s.compressedMessages,
        compressedFromCount: s.compressedFromCount,
        compressedAt: s.compressedAt,
      })
    }

    persistFromState()

    const cleanupToken = window.api.onAiToken((d) => get().appendToken(d))
    const cleanupToolStart = window.api.onAiToolCallStart((d) => get().appendToolStart(d))
    const cleanupToolEnd = window.api.onAiToolCallEnd((d) => get().resolveToolEnd(d))
    const cleanupThinking = window.api.onAiThinking((d) => get().appendThinking(d))
    const cleanupAskUser = window.api.onAiAskUser((d) => get().appendAskUser(d))
    const cleanupInjected = window.api.onAiInjectedMessage((d) => get().appendInjectedMessage(d))
    const cleanupModelSelected = window.api.onAiModelSelected((d) => {
      const pid = get().assistantPlaceholderId
      if (pid) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === pid && m.role === 'assistant' ? { ...m, modelDisplay: d.modelDisplay } : m
          )
        }))
      } else {
        // No segment yet — store for the first token to pick up
        set({ pendingModelDisplay: d.modelDisplay })
      }
    })

    const cleanupStreamReset = window.api.onAiStreamReset((d) => {
      const pid = get().assistantPlaceholderId
      if (!pid) return
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === pid && m.role === 'assistant'
            ? { ...m, content: '', modelDisplay: d.fallbackModel, fallbackNotice: `${m.modelDisplay ?? 'Model'} failed: ${d.errorMessage}` }
            : m
        )
      }))
    })

    const cleanup = (): void => {
      cleanupToken()
      cleanupToolStart()
      cleanupToolEnd()
      cleanupThinking()
      cleanupAskUser()
      cleanupInjected()
      cleanupModelSelected()
      cleanupStreamReset()
    }

    // Electron's webContents.send (used for IPC.AI_TOKEN / IPC.AI_THINKING / etc.)
    // and ipcMain.handle response (returned by window.api.aiChat) travel on
    // separate IPC paths with no FIFO ordering between them. The invoke
    // response can overtake several streaming events. Deferring listener
    // teardown + placeholder reset by a few hundred ms gives the streaming
    // events time to land before the listeners go away.
    const POST_RESOLUTION_DEFER_MS = 250

    try {
      const response = await window.api.aiChat(
        [...apiMessages, { role: 'user', content: trimmed, attachments: userMsg.attachments }],
        rootPath,
        sessionId!
      )

      setTimeout(() => {
        cleanup()
        const placeholderId = get().assistantPlaceholderId

        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id === placeholderId && m.role === 'assistant') {
              return { ...m, streaming: false, modelDisplay: response.modelDisplay }
            }
            if (m.role === 'thinking' && (m as ThinkingMessage).streaming) {
              return { ...m, streaming: false }
            }
            return m
          }),
          isLoading: false,
          assistantPlaceholderId: null,
          thinkingPlaceholderId: null,
          pendingModelDisplay: null
        }))

        persistFromState()
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, updatedAt: Date.now() } : sess
          )
        }))

        // Refresh after each settled turn so the toast can fire when usage
        // crosses the threshold. Failures are swallowed — status is best-effort.
        get().refreshContextStatus(rootPath).catch(() => { /* ignore */ })

        if (response.modifiedFiles.length > 0) {
          useProjectStore.getState().refreshTree()
        }
      }, POST_RESOLUTION_DEFER_MS)
    } catch (err) {
      // Defer the same way as the success path so streaming events that
      // arrived before the error can still land on the right placeholder.
      const handleError = (): void => {
      cleanup()

      const isAbort = err instanceof Error &&
        (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))

      if (isAbort) {
        const placeholderId = get().assistantPlaceholderId
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id === placeholderId && m.role === 'assistant') return { ...m, streaming: false }
            if (m.role === 'thinking' && (m as ThinkingMessage).streaming) return { ...m, streaming: false }
            if (m.role === 'ask_user' && (m as AskUserMessage).answer === null) return { ...m, answer: '[cancelled]' }
            return m
          }),
          isLoading: false,
          assistantPlaceholderId: null,
          thinkingPlaceholderId: null,
          pendingModelDisplay: null
        }))
        persistFromState()
        return
      }

      const placeholderId = get().assistantPlaceholderId
      const errorContent = `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`

      set((s) => {
        if (placeholderId) {
          return {
            messages: s.messages.map((m) => {
              if (m.id === placeholderId && m.role === 'assistant') {
                return { ...m, content: errorContent, streaming: false, isError: true }
              }
              if (m.role === 'thinking' && (m as ThinkingMessage).streaming) {
                return { ...m, streaming: false }
              }
              return m
            }),
            isLoading: false,
            assistantPlaceholderId: null,
            thinkingPlaceholderId: null,
            pendingModelDisplay: null
          }
        }
        // No assistant segment yet — append a new error message
        const errorMsg: AssistantMessage = {
          id: `msg-${++msgCounter}`,
          role: 'assistant',
          content: errorContent,
          timestamp: Date.now(),
          streaming: false,
          isError: true
        }
        return {
          messages: [
            ...s.messages.map((m) =>
              m.role === 'thinking' && (m as ThinkingMessage).streaming ? { ...m, streaming: false } : m
            ),
            errorMsg
          ],
          isLoading: false,
          assistantPlaceholderId: null,
          thinkingPlaceholderId: null,
          pendingModelDisplay: null
        }
      })

      persistFromState()
      }
      setTimeout(handleError, POST_RESOLUTION_DEFER_MS)
    }
  },

  clearMessages: () => set({ messages: [], isLoading: false }),

  loadSessions: async (rootPath) => {
    const sessions = await window.api.session.list(rootPath)
    set({ sessions: sessions as SessionMeta[] })

    if (sessions.length > 0) {
      const first = sessions[0]
      const loaded = await window.api.session.load(rootPath, first.id)
      if (loaded) {
        set({
          currentSessionId: first.id,
          messages: sanitizeLoadedMessages((loaded.messages as ChatMessage[]) ?? []),
          compressedMessages: loaded.compressedMessages ?? null,
          compressedFromCount: loaded.compressedFromCount ?? null,
          compressedAt: loaded.compressedAt ?? null,
          compressionToastDismissed: null,
          contextStatus: null,
        })
        get().refreshContextStatus(rootPath).catch(() => { /* ignore */ })
      }
    }
  },

  switchSession: async (rootPath, sessionId) => {
    const loaded = await window.api.session.load(rootPath, sessionId)
    if (loaded) {
      set({
        currentSessionId: sessionId,
        messages: sanitizeLoadedMessages((loaded.messages as ChatMessage[]) ?? []),
        isLoading: false,
        assistantPlaceholderId: null,
        thinkingPlaceholderId: null,
        pendingModelDisplay: null,
        compressedMessages: loaded.compressedMessages ?? null,
        compressedFromCount: loaded.compressedFromCount ?? null,
        compressedAt: loaded.compressedAt ?? null,
        compressionToastDismissed: null,
        contextStatus: null,
      })
      get().refreshContextStatus(rootPath).catch(() => { /* ignore */ })
    }
  },

  newSession: () => set({
    currentSessionId: null,
    messages: [],
    isLoading: false,
    assistantPlaceholderId: null,
    thinkingPlaceholderId: null,
    pendingModelDisplay: null,
    compressedMessages: null,
    compressedFromCount: null,
    compressedAt: null,
    contextStatus: null,
    compressionToastDismissed: null,
  }),

  refreshContextStatus: async (rootPath) => {
    if (get().messages.length === 0) {
      set({ contextStatus: null })
      return
    }
    const status = await window.api.aiContextStatus(rootPath, get().messages as unknown as Array<Record<string, unknown>>)
    set({ contextStatus: status })
  },

  compressNow: async (rootPath) => {
    const sessionId = get().currentSessionId
    if (!sessionId || get().isCompressing) return
    set({ isCompressing: true })
    try {
      const result = await window.api.aiCompressToolNoise(
        rootPath,
        get().messages as unknown as Array<Record<string, unknown>>
      )
      if (result) {
        const at = Date.now()
        set({
          compressedMessages: result.compressedMessages,
          compressedFromCount: result.compressedFromCount,
          compressedAt: at,
          // After successful compression, clear the dismiss snapshot so the
          // next threshold cross can fire again (with the new lower baseline).
          compressionToastDismissed: null,
        })
        // Persist the new snapshot. We need session metadata to call persistSession.
        const session = get().sessions.find((s) => s.id === sessionId)
        if (session) {
          persistSession(rootPath, sessionId, session.title, session.createdAt, get().messages, {
            compressedMessages: result.compressedMessages,
            compressedFromCount: result.compressedFromCount,
            compressedAt: at,
          })
        }
        await get().refreshContextStatus(rootPath)
      }
    } finally {
      set({ isCompressing: false })
    }
  },

  dismissCompressionToast: () => {
    const status = get().contextStatus
    if (!status) return
    set({
      compressionToastDismissed: {
        percentUsed: status.percentUsed,
        totalToolSteps: status.totalToolSteps,
      },
    })
  },

  renameSession: async (rootPath, sessionId, title) => {
    const loaded = await window.api.session.load(rootPath, sessionId)
    if (!loaded) return
    await window.api.session.save(rootPath, { ...loaded, title, updatedAt: Date.now() })
    set((s) => ({
      sessions: s.sessions.map((sess) => sess.id === sessionId ? { ...sess, title } : sess)
    }))
  },

  deleteSession: async (rootPath, sessionId) => {
    await window.api.session.delete(rootPath, sessionId)
    const wasActive = get().currentSessionId === sessionId
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== sessionId) }))
    if (wasActive) get().newSession()
  }
}))
