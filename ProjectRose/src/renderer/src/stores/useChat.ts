import { create } from 'zustand'
import type { MessageAttachment } from '@shared/roseModelTypes'
import type {
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  AskUserMessage,
  InjectedMessage,
  SessionMeta,
  CompressionSnapshot,
  CompressedApiMessage,
  ContextStatus,
} from '../types/chatMessages'
import { useProjectStore } from './useProjectStore'
import { useSettingsStore } from './useSettingsStore'
import { useScreenWebcamShare } from '../hooks/useScreenWebcamShare'

// Tool-step count is fixed at 50 because it's a property of the agentic loop
// budget rather than the model.
export const TOOL_STEP_THRESHOLD = 50
// Hysteresis after dismiss: re-show only once usage has grown by 10pp OR by
// another 25 tool steps. Prevents the toast from re-appearing every turn.
export const REDISPLAY_PCT_DELTA = 0.1
export const REDISPLAY_TOOL_DELTA = 25

// Electron's webContents.send (used for IPC.AI_TOKEN / IPC.AI_THINKING / etc.)
// and ipcMain.handle response (returned by window.api.aiChat) travel on
// separate IPC paths with no FIFO ordering between them. The invoke response
// can overtake several streaming events. Deferring listener teardown +
// placeholder reset by a few hundred ms gives the streaming events time to
// land before the listeners go away.
const POST_RESOLUTION_DEFER_MS = 250

let msgCounter = 0
function makeId(): string {
  return `msg-${++msgCounter}`
}

let userMsgCounter = 0
function newUserMsgId(): string {
  return `msg-u-${++userMsgCounter}`
}

function newSessionId(): string {
  return crypto.randomUUID()
}

// Distinguish a user-pressed cancel from an upstream "abort"-named error;
// `activeDeferTimer` lets a session change abort the deferred settle.
let userCancelled = false
let activeDeferTimer: ReturnType<typeof setTimeout> | null = null

function clearDeferTimer(): void {
  if (activeDeferTimer) {
    clearTimeout(activeDeferTimer)
    activeDeferTimer = null
  }
}

// ── Timeline reducers (formerly in services/chatTimelineReducers.ts) ───────

function insertBefore(messages: ChatMessage[], targetId: string, insert: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === targetId)
  if (idx < 0) return [...messages, insert]
  return [...messages.slice(0, idx), insert, ...messages.slice(idx)]
}

function sealStreamingPlaceholders(state: TimelineFields): ChatMessage[] {
  return state.messages.map((m) => {
    if (m.id === state.thinkingPlaceholderId && m.role === 'thinking') return { ...m, streaming: false }
    if (m.id === state.assistantPlaceholderId && m.role === 'assistant') return { ...m, streaming: false }
    return m
  })
}

interface TimelineFields {
  messages: ChatMessage[]
  assistantPlaceholderId: string | null
  thinkingPlaceholderId: string | null
  pendingModelDisplay: string | null
  isLoading: boolean
}

const emptyTimeline: TimelineFields = {
  messages: [],
  assistantPlaceholderId: null,
  thinkingPlaceholderId: null,
  pendingModelDisplay: null,
  isLoading: false,
}

// ── Api-message builder (formerly in services/chatApiMessages.ts) ──────────

export type ApiMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: MessageAttachment[]
}

function settledMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m) => !(m as AssistantMessage).streaming && !(m as ThinkingMessage).streaming
  )
}

function buildApiMessages(messages: ChatMessage[], includeThinking: boolean): ApiMessage[] {
  const settled = settledMessages(messages)
  if (includeThinking) {
    const apiMessages: ApiMessage[] = []
    let pendingThinking = ''
    for (const m of settled) {
      if (m.role === 'thinking') {
        pendingThinking += (pendingThinking ? '\n\n' : '') + m.content
      } else if (m.role === 'user') {
        pendingThinking = ''
        apiMessages.push({
          role: 'user',
          content: m.content,
          attachments: (m as UserMessage).attachments,
        })
      } else if (m.role === 'assistant') {
        const content = pendingThinking
          ? `<thinking>\n${pendingThinking}\n</thinking>\n\n${m.content}`
          : m.content
        pendingThinking = ''
        apiMessages.push({ role: 'assistant', content })
      } else if (m.role === 'injected') {
        pendingThinking = ''
        apiMessages.push({
          role: 'system',
          content: `[Extension ${(m as InjectedMessage).extensionName}] ${(m as InjectedMessage).content}`,
        })
      }
    }
    return apiMessages
  }
  return settled
    .filter(
      (m): m is UserMessage | AssistantMessage | InjectedMessage =>
        m.role === 'user' || m.role === 'assistant' || m.role === 'injected'
    )
    .map((m): ApiMessage => {
      if (m.role === 'injected') {
        return { role: 'system', content: `[Extension ${m.extensionName}] ${m.content}` }
      }
      if (m.role === 'user') {
        return { role: 'user', content: m.content, attachments: m.attachments }
      }
      return { role: 'assistant', content: m.content }
    })
}

function substituteCompressionSnapshot(
  apiMessages: ApiMessage[],
  snapshot: { compressedMessages: CompressedApiMessage[]; compressedFromCount: number } | null
): ApiMessage[] {
  if (!snapshot || apiMessages.length < snapshot.compressedFromCount) return apiMessages
  const tail = apiMessages.slice(snapshot.compressedFromCount)
  return [
    ...snapshot.compressedMessages.map((m): ApiMessage => ({ role: m.role, content: m.content })),
    ...tail,
  ]
}

function sanitizeLoadedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if ((m.role === 'assistant' || m.role === 'thinking') && (m as AssistantMessage).streaming) {
      return {
        ...m,
        streaming: false,
        content: (m as AssistantMessage).content || '[interrupted]',
      }
    }
    if (m.role === 'ask_user' && (m as AskUserMessage).answer === null) {
      return { ...m, answer: '[interrupted]' }
    }
    return m
  })
}

// ── Persistence helpers (formerly in services/chatPersistence.ts) ──────────

function readSnapshot(state: UseChatSlice): CompressionSnapshot | null {
  if (
    state.compressedMessages &&
    state.compressedFromCount != null &&
    state.compressedFromRawCount != null &&
    state.compressedAt != null
  ) {
    return {
      compressedMessages: state.compressedMessages,
      compressedFromCount: state.compressedFromCount,
      compressedFromRawCount: state.compressedFromRawCount,
      compressedAt: state.compressedAt,
    }
  }
  return null
}

function buildPayload(
  meta: SessionMeta,
  messages: ChatMessage[],
  snapshot: CompressionSnapshot | null
): Parameters<typeof window.api.session.save>[1] {
  const payload: Parameters<typeof window.api.session.save>[1] = {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: Date.now(),
    messages: messages as unknown[],
  }
  if (snapshot) {
    payload.compressedMessages = snapshot.compressedMessages
    payload.compressedFromCount = snapshot.compressedFromCount
    payload.compressedFromRawCount = snapshot.compressedFromRawCount
    payload.compressedAt = snapshot.compressedAt
  }
  return payload
}

function persistSession(rootPath: string, meta: SessionMeta): void {
  const state = useChat.getState()
  const messages = state.messages
  const snapshot = readSnapshot(state)
  window.api.session.save(rootPath, buildPayload(meta, messages, snapshot)).catch(() => {
    /* persistence failures are non-fatal */
  })
}

// ── Threshold predicate (used by useShouldShowToast) ───────────────────────

export function evaluateShouldShowToast(
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

// ── Empty-response detection ───────────────────────────────────────────────

export function detectEmptyResponseError(args: {
  response: { content: string; modifiedFiles: string[] }
  lastMessageId: string | undefined
  userMsg: UserMessage
  hasAttachment: boolean
  isManaged: boolean
}): string | null {
  const { response, lastMessageId, userMsg, hasAttachment, isManaged } = args
  const isEmpty =
    response.content === '' &&
    response.modifiedFiles.length === 0 &&
    lastMessageId === userMsg.id
  if (!isEmpty) return null
  let hint = ''
  if (hasAttachment) {
    hint = isManaged
      ? ' Server image support is coming soon — if you want to use screen share you will need a vision-capable local model for now.'
      : ' The selected model may not support image input — try a vision-capable model, or stop sharing your screen/camera.'
  }
  return `Error: The model returned an empty response.${hint}`
}

// ── Slice interface ────────────────────────────────────────────────────────

export interface UseChatSlice {
  // Timeline state
  messages: ChatMessage[]
  assistantPlaceholderId: string | null
  thinkingPlaceholderId: string | null
  pendingModelDisplay: string | null
  isLoading: boolean

  // UI state
  inputValue: string
  isRecording: boolean
  searchQuery: string

  // Sessions state
  sessions: SessionMeta[]
  currentSessionId: string | null

  // Compression / context state
  compressedMessages: CompressionSnapshot['compressedMessages'] | null
  compressedFromCount: number | null
  compressedFromRawCount: number | null
  compressedAt: number | null
  contextStatus: ContextStatus | null
  toastDismissed: { percentUsed: number; totalToolSteps: number } | null
  isCompressing: boolean

  // Public actions
  send: () => Promise<void>
  cancel: () => Promise<void>
  answerAskUser: (questionId: string, answer: string) => Promise<void>
  setInputValue: (value: string) => void
  setIsRecording: (value: boolean) => void
  setSearchQuery: (value: string) => void
  compressNow: () => Promise<void>
  dismissCompressionToast: () => void
  newSession: () => void
  loadSessions: () => Promise<void>
  switchSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  refreshContextStatus: () => Promise<void>
  clearForProjectSwitch: () => void

  // Internal-but-public mutators (used by IPC listeners and tests).
  // Components should not call these directly; they remain on the surface
  // because tests against the slice exercise the same transitions the
  // streaming events drive.
  appendToken: (data: { sessionId: string; token: string }) => void
  appendToolStart: (data: { sessionId: string; id: string; name: string; params: Record<string, unknown> }) => void
  resolveToolEnd: (data: { sessionId: string; id: string; result: string; error: boolean }) => void
  appendThinking: (data: { sessionId: string; content: string }) => void
  appendAskUser: (data: { sessionId: string; questionId: string; question: string; options: string[] }) => void
  applyAnswer: (data: { questionId: string; answer: string }) => void
  appendInjectedMessage: (data: {
    sessionId: string
    extensionId: string
    extensionName: string
    extensionIcon?: string
    content: string
  }) => void
  modelSelected: (data: { sessionId: string; modelDisplay: string }) => void
  streamReset: (data: { sessionId: string; fallbackModel: string; errorMessage: string }) => void
  startTurn: (userMessage: ChatMessage) => void
  settleTurn: (data: { modelDisplay: string }) => void
  abortCleanup: () => void
  errorCleanup: (data: { errorContent: string }) => void
  resetTimeline: () => void
  setMessages: (messages: ChatMessage[]) => void

  // Sessions mutators
  setSessions: (sessions: SessionMeta[]) => void
  setCurrentSessionId: (id: string | null) => void
  upsertSession: (session: SessionMeta) => void
  removeSession: (id: string) => void
  renameSessionLocal: (id: string, title: string) => void
  touchSession: (id: string) => void

  // Compression mutators
  setSnapshot: (snapshot: CompressionSnapshot | null) => void
  setContextStatus: (status: ContextStatus | null) => void
  setIsCompressing: (v: boolean) => void
  setToastDismissed: (v: { percentUsed: number; totalToolSteps: number } | null) => void
  resetCompression: () => void
}

const initialCompression = {
  compressedMessages: null,
  compressedFromCount: null,
  compressedFromRawCount: null,
  compressedAt: null,
  contextStatus: null,
  toastDismissed: null,
  isCompressing: false,
}

export const useChat = create<UseChatSlice>((set, get) => ({
  ...emptyTimeline,

  inputValue: '',
  isRecording: false,
  searchQuery: '',

  sessions: [],
  currentSessionId: null,

  ...initialCompression,

  // ── Timeline mutators ─────────────────────────────────────────────────
  setMessages: (messages) => set({ messages }),
  resetTimeline: () => set({ ...emptyTimeline }),

  appendToken: ({ token }) =>
    set((s) => {
      if (s.assistantPlaceholderId) {
        return {
          messages: s.messages.map((m) =>
            m.id === s.assistantPlaceholderId && m.role === 'assistant'
              ? { ...m, content: m.content + token }
              : m
          ),
        }
      }
      const newId = makeId()
      const msg: AssistantMessage = {
        id: newId,
        role: 'assistant',
        content: token,
        timestamp: Date.now(),
        streaming: true,
        modelDisplay: s.pendingModelDisplay ?? undefined,
      }
      return {
        messages: [...s.messages, msg],
        assistantPlaceholderId: newId,
      }
    }),

  appendToolStart: ({ id, name, params }) =>
    set((s) => {
      const toolMsg: ToolMessage = {
        id: makeId(),
        role: 'tool',
        timestamp: Date.now(),
        toolId: id,
        name,
        params,
        result: null,
        error: false,
        pending: true,
      }
      return {
        messages: [...sealStreamingPlaceholders(s), toolMsg],
        thinkingPlaceholderId: null,
        assistantPlaceholderId: null,
      }
    }),

  resolveToolEnd: ({ id, result, error }) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.role === 'tool' && m.toolId === id
          ? { ...m, result, error, pending: false }
          : m
      ),
    })),

  appendThinking: ({ content }) =>
    set((s) => {
      if (s.thinkingPlaceholderId) {
        return {
          messages: s.messages.map((m) =>
            m.id === s.thinkingPlaceholderId && m.role === 'thinking'
              ? { ...m, content: m.content + content }
              : m
          ),
        }
      }
      const newId = makeId()
      const msg: ThinkingMessage = {
        id: newId,
        role: 'thinking',
        timestamp: Date.now(),
        content,
        streaming: true,
      }
      return {
        messages: s.assistantPlaceholderId
          ? insertBefore(s.messages, s.assistantPlaceholderId, msg)
          : [...s.messages, msg],
        thinkingPlaceholderId: newId,
      }
    }),

  appendAskUser: ({ questionId, question, options }) =>
    set((s) => {
      const msg: AskUserMessage = {
        id: makeId(),
        role: 'ask_user',
        timestamp: Date.now(),
        questionId,
        question,
        options,
        answer: null,
      }
      return {
        messages: [...sealStreamingPlaceholders(s), msg],
        thinkingPlaceholderId: null,
        assistantPlaceholderId: null,
      }
    }),

  applyAnswer: ({ questionId, answer }) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.role === 'ask_user' && m.questionId === questionId
          ? { ...m, answer }
          : m
      ),
    })),

  appendInjectedMessage: ({ extensionId, extensionName, extensionIcon, content }) =>
    set((s) => {
      const msg: InjectedMessage = {
        id: makeId(),
        role: 'injected',
        timestamp: Date.now(),
        content,
        extensionId,
        extensionName,
        extensionIcon,
      }
      return {
        messages: [...sealStreamingPlaceholders(s), msg],
        thinkingPlaceholderId: null,
        assistantPlaceholderId: null,
      }
    }),

  modelSelected: ({ modelDisplay }) =>
    set((s) => {
      if (s.assistantPlaceholderId) {
        return {
          messages: s.messages.map((m) =>
            m.id === s.assistantPlaceholderId && m.role === 'assistant'
              ? { ...m, modelDisplay }
              : m
          ),
        }
      }
      return { pendingModelDisplay: modelDisplay }
    }),

  streamReset: ({ fallbackModel, errorMessage }) =>
    set((s) => {
      if (!s.assistantPlaceholderId) return {}
      return {
        messages: s.messages.map((m) =>
          m.id === s.assistantPlaceholderId && m.role === 'assistant'
            ? {
                ...m,
                content: '',
                modelDisplay: fallbackModel,
                fallbackNotice: `${m.modelDisplay ?? 'Model'} failed: ${errorMessage}`,
              }
            : m
        ),
      }
    }),

  startTurn: (userMessage) =>
    set((s) => ({
      messages: [...s.messages, userMessage],
      isLoading: true,
      assistantPlaceholderId: null,
      thinkingPlaceholderId: null,
      pendingModelDisplay: null,
    })),

  settleTurn: ({ modelDisplay }) =>
    set((s) => {
      const placeholderId = s.assistantPlaceholderId
      return {
        messages: s.messages.map((m) => {
          if (m.id === placeholderId && m.role === 'assistant') {
            return { ...m, streaming: false, modelDisplay }
          }
          if (m.role === 'thinking' && (m as ThinkingMessage).streaming) {
            return { ...m, streaming: false }
          }
          return m
        }),
        isLoading: false,
        assistantPlaceholderId: null,
        thinkingPlaceholderId: null,
        pendingModelDisplay: null,
      }
    }),

  abortCleanup: () =>
    set((s) => {
      const placeholderId = s.assistantPlaceholderId
      return {
        messages: s.messages.map((m) => {
          if (m.id === placeholderId && m.role === 'assistant') return { ...m, streaming: false }
          if (m.role === 'thinking' && (m as ThinkingMessage).streaming) return { ...m, streaming: false }
          if (m.role === 'ask_user' && (m as AskUserMessage).answer === null) return { ...m, answer: '[cancelled]' }
          return m
        }),
        isLoading: false,
        assistantPlaceholderId: null,
        thinkingPlaceholderId: null,
        pendingModelDisplay: null,
      }
    }),

  errorCleanup: ({ errorContent }) =>
    set((s) => {
      const placeholderId = s.assistantPlaceholderId
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
          pendingModelDisplay: null,
        }
      }
      const errorMsg: AssistantMessage = {
        id: makeId(),
        role: 'assistant',
        content: errorContent,
        timestamp: Date.now(),
        streaming: false,
        isError: true,
      }
      return {
        messages: [
          ...s.messages.map((m) =>
            m.role === 'thinking' && (m as ThinkingMessage).streaming ? { ...m, streaming: false } : m
          ),
          errorMsg,
        ],
        isLoading: false,
        assistantPlaceholderId: null,
        thinkingPlaceholderId: null,
        pendingModelDisplay: null,
      }
    }),

  // ── UI mutators ───────────────────────────────────────────────────────
  setInputValue: (inputValue) => set({ inputValue }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // ── Sessions mutators ─────────────────────────────────────────────────
  setSessions: (sessions) => set({ sessions }),
  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  upsertSession: (session) =>
    set((s) => {
      const exists = s.sessions.some((x) => x.id === session.id)
      return {
        sessions: exists
          ? s.sessions.map((x) => (x.id === session.id ? session : x))
          : [session, ...s.sessions],
      }
    }),
  removeSession: (id) =>
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
  renameSessionLocal: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
    })),
  touchSession: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, updatedAt: Date.now() } : x
      ),
    })),

  // ── Compression mutators ──────────────────────────────────────────────
  setSnapshot: (snapshot) =>
    set(
      snapshot
        ? {
            compressedMessages: snapshot.compressedMessages,
            compressedFromCount: snapshot.compressedFromCount,
            compressedFromRawCount: snapshot.compressedFromRawCount,
            compressedAt: snapshot.compressedAt,
          }
        : {
            compressedMessages: null,
            compressedFromCount: null,
            compressedFromRawCount: null,
            compressedAt: null,
          }
    ),
  setContextStatus: (contextStatus) => set({ contextStatus }),
  setIsCompressing: (isCompressing) => set({ isCompressing }),
  setToastDismissed: (toastDismissed) => set({ toastDismissed }),
  resetCompression: () => set({ ...initialCompression }),

  // ── High-level actions ────────────────────────────────────────────────
  send: async () => {
    const trimmed = get().inputValue.trim()
    if (!trimmed || get().isLoading) return
    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return

    userCancelled = false

    const includeThinking = useSettingsStore.getState().includeThinkingInContext
    const compressionSnapshot =
      get().compressedMessages && get().compressedFromCount != null
        ? {
            compressedMessages: get().compressedMessages!,
            compressedFromCount: get().compressedFromCount!,
          }
        : null

    const baseApiMessages = buildApiMessages(get().messages, includeThinking)
    const apiMessages = substituteCompressionSnapshot(baseApiMessages, compressionSnapshot)

    const frame = await useScreenWebcamShare.getState().captureFrame()

    const userMsg: UserMessage = {
      id: newUserMsgId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      ...(frame ? { attachments: [frame] } : {}),
    }

    let sessionId = get().currentSessionId
    let sessionMeta = sessionId
      ? get().sessions.find((s) => s.id === sessionId)
      : undefined
    if (!sessionId || !sessionMeta) {
      sessionId = newSessionId()
      const now = Date.now()
      sessionMeta = { id: sessionId, title: trimmed.slice(0, 50), createdAt: now, updatedAt: now }
      get().upsertSession(sessionMeta)
      get().setCurrentSessionId(sessionId)
    }

    get().setInputValue('')
    get().startTurn(userMsg)
    persistSession(rootPath, sessionMeta)

    // Streaming listener wire-up with sessionId filtering: late events from
    // an abandoned session would otherwise land on the new session's timeline.
    const turnSessionId = sessionId
    const forThisTurn = <T extends { sessionId: string }>(handler: (d: T) => void) =>
      (d: T): void => {
        if (d.sessionId !== turnSessionId) return
        handler(d)
      }
    const cleanupToken = window.api.onAiToken(forThisTurn((d) => get().appendToken(d)))
    const cleanupToolStart = window.api.onAiToolCallStart(forThisTurn((d) => get().appendToolStart(d)))
    const cleanupToolEnd = window.api.onAiToolCallEnd(forThisTurn((d) => get().resolveToolEnd(d)))
    const cleanupThinking = window.api.onAiThinking(forThisTurn((d) => get().appendThinking(d)))
    const cleanupAskUser = window.api.onAiAskUser(forThisTurn((d) => get().appendAskUser(d)))
    const cleanupInjected = window.api.onAiInjectedMessage(forThisTurn((d) => get().appendInjectedMessage(d)))
    const cleanupModelSelected = window.api.onAiModelSelected(forThisTurn((d) => get().modelSelected(d)))
    const cleanupStreamReset = window.api.onAiStreamReset(forThisTurn((d) => get().streamReset(d)))

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

    try {
      const response = await window.api.aiChat(
        [
          ...apiMessages,
          { role: 'user', content: trimmed, attachments: userMsg.attachments },
        ] as Parameters<typeof window.api.aiChat>[0],
        rootPath,
        sessionId
      )

      clearDeferTimer()
      activeDeferTimer = setTimeout(() => {
        activeDeferTimer = null
        cleanup()
        const lastMsg = get().messages[get().messages.length - 1]
        const emptyError = detectEmptyResponseError({
          response,
          lastMessageId: lastMsg?.id,
          userMsg,
          hasAttachment: (userMsg.attachments?.length ?? 0) > 0,
          isManaged: useSettingsStore.getState().hostMode === 'projectrose',
        })
        if (emptyError) {
          get().errorCleanup({ errorContent: emptyError })
        } else {
          get().settleTurn({ modelDisplay: response.modelDisplay })
        }
        get().touchSession(sessionId)
        const updatedMeta = get().sessions.find((s) => s.id === sessionId) ?? sessionMeta!
        persistSession(rootPath, updatedMeta)
        // Refresh status after each settled turn so the toast can fire.
        get().refreshContextStatus().catch(() => { /* best-effort */ })
        if (response.modifiedFiles.length > 0) {
          useProjectStore.getState().refreshTree()
        }
      }, POST_RESOLUTION_DEFER_MS)
    } catch (err) {
      const wasUserCancelled = userCancelled
      clearDeferTimer()
      activeDeferTimer = setTimeout(() => {
        activeDeferTimer = null
        cleanup()
        const isAbort =
          wasUserCancelled || (err instanceof Error && err.name === 'AbortError')
        if (isAbort) {
          get().abortCleanup()
        } else {
          const errorContent = `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`
          get().errorCleanup({ errorContent })
        }
        persistSession(rootPath, sessionMeta!)
      }, POST_RESOLUTION_DEFER_MS)
    }
  },

  cancel: async () => {
    userCancelled = true
    const sessionId = get().currentSessionId
    if (!sessionId) return
    await window.api.aiCancelGeneration(sessionId)
  },

  answerAskUser: async (questionId, answer) => {
    get().applyAnswer({ questionId, answer })
    const sessionId = get().currentSessionId
    if (!sessionId) return
    await window.api.aiAskUserResponse(sessionId, questionId, answer)
  },

  compressNow: async () => {
    const rootPath = useProjectStore.getState().rootPath
    const sessionId = get().currentSessionId
    if (!rootPath || !sessionId || get().isCompressing) return
    set({ isCompressing: true })
    try {
      const messages = get().messages
      const result = await window.api.aiCompressToolNoise(
        rootPath,
        messages as unknown as Array<Record<string, unknown>>
      )
      if (result) {
        const at = Date.now()
        get().setSnapshot({
          compressedMessages: result.compressedMessages,
          compressedFromCount: result.compressedFromCount,
          compressedFromRawCount: result.compressedFromRawCount,
          compressedAt: at,
        })
        const meta = get().sessions.find((s) => s.id === sessionId)
        if (meta) persistSession(rootPath, meta)
        await get().refreshContextStatus()
        const fresh = get().contextStatus
        get().setToastDismissed(
          fresh ? { percentUsed: fresh.percentUsed, totalToolSteps: fresh.totalToolSteps } : null
        )
      }
    } finally {
      set({ isCompressing: false })
    }
  },

  dismissCompressionToast: () => {
    const status = get().contextStatus
    if (!status) return
    set({
      toastDismissed: {
        percentUsed: status.percentUsed,
        totalToolSteps: status.totalToolSteps,
      },
    })
  },

  newSession: () => {
    clearDeferTimer()
    set({ currentSessionId: null })
    get().resetTimeline()
    get().resetCompression()
  },

  loadSessions: async () => {
    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return
    const sessions = (await window.api.session.list(rootPath)) as SessionMeta[]
    get().setSessions(sessions)
    if (sessions.length > 0) {
      await loadSessionIntoSlice(rootPath, sessions[0].id)
      await get().refreshContextStatus().catch(() => { /* best-effort */ })
    }
  },

  switchSession: async (id) => {
    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return
    await loadSessionIntoSlice(rootPath, id)
    await get().refreshContextStatus().catch(() => { /* best-effort */ })
  },

  deleteSession: async (id) => {
    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return
    await window.api.session.delete(rootPath, id)
    const wasActive = get().currentSessionId === id
    get().removeSession(id)
    if (wasActive) {
      get().setCurrentSessionId(null)
      get().resetTimeline()
      get().resetCompression()
    }
  },

  renameSession: async (id, title) => {
    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return
    const loaded = await window.api.session.load(rootPath, id)
    if (!loaded) return
    await window.api.session.save(rootPath, { ...loaded, title, updatedAt: Date.now() })
    get().renameSessionLocal(id, title)
  },

  refreshContextStatus: async () => {
    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return
    const messages = get().messages
    if (messages.length === 0) {
      set({ contextStatus: null })
      return
    }
    const snapshot =
      get().compressedMessages &&
      get().compressedFromCount != null &&
      get().compressedFromRawCount != null
        ? {
            compressedMessages: get().compressedMessages!,
            compressedFromCount: get().compressedFromCount!,
            compressedFromRawCount: get().compressedFromRawCount!,
          }
        : null
    const status = await window.api.aiContextStatus(
      rootPath,
      messages as unknown as Array<Record<string, unknown>>,
      snapshot
    )
    set({ contextStatus: status })
  },

  clearForProjectSwitch: () => {
    clearDeferTimer()
    get().resetTimeline()
    set({ sessions: [], currentSessionId: null })
    get().resetCompression()
  },
}))

// Load a session's messages + compression snapshot into the slice. Internal
// helper used by `loadSessions` and `switchSession`.
async function loadSessionIntoSlice(rootPath: string, sessionId: string): Promise<void> {
  const loaded = await window.api.session.load(rootPath, sessionId)
  if (!loaded) return
  const hasFullSnapshot =
    !!loaded.compressedMessages &&
    loaded.compressedFromCount != null &&
    loaded.compressedFromRawCount != null &&
    loaded.compressedAt != null

  useChat.getState().resetTimeline()
  useChat
    .getState()
    .setMessages(sanitizeLoadedMessages((loaded.messages as ChatMessage[]) ?? []))
  useChat.getState().setCurrentSessionId(sessionId)
  useChat.getState().setSnapshot(
    hasFullSnapshot
      ? {
          compressedMessages: loaded.compressedMessages!,
          compressedFromCount: loaded.compressedFromCount!,
          compressedFromRawCount: loaded.compressedFromRawCount!,
          compressedAt: loaded.compressedAt!,
        }
      : null
  )
  useChat.getState().setContextStatus(null)
  useChat.getState().setToastDismissed(null)
}

/**
 * One-stop selector for the compression toast.
 */
export function useShouldShowToast(): boolean {
  const status = useChat((s) => s.contextStatus)
  const dismissed = useChat((s) => s.toastDismissed)
  const tokenThresholdPct = useSettingsStore((s) => s.compressionThresholdPct)
  return evaluateShouldShowToast(status, dismissed, tokenThresholdPct)
}
