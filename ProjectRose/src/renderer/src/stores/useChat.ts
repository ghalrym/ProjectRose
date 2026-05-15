import { create } from 'zustand'
import type { ChatMessage, SessionMeta, ContextStatus, CompressionSnapshot, UserMessage } from '../types/chatMessages'
import { useChatTimelineStore } from './useChatTimelineStore'
import { useChatUIStore } from './useChatUIStore'
import { useSessionsStore } from './useSessionsStore'
import { useCompressionStore, evaluateShouldShowToast } from './useCompressionStore'
import { useProjectStore } from './useProjectStore'
import { useSettingsStore } from './useSettingsStore'
import { useScreenWebcamShare } from '../hooks/useScreenWebcamShare'
import { buildApiMessages, substituteCompressionSnapshot } from '../services/chatApiMessages'
import {
  persistSession,
  loadAllSessions,
  loadSessionInto,
  deleteSessionFor,
  renameSessionFor,
} from '../services/chatPersistence'

// Electron's webContents.send (used for IPC.AI_TOKEN / IPC.AI_THINKING / etc.)
// and ipcMain.handle response (returned by window.api.aiChat) travel on
// separate IPC paths with no FIFO ordering between them. The invoke response
// can overtake several streaming events. Deferring listener teardown +
// placeholder reset by a few hundred ms gives the streaming events time to
// land before the listeners go away. Owned by the slice so a fast
// `newSession()` / `cancel()` / `clearForProjectSwitch()` can clear it.
const POST_RESOLUTION_DEFER_MS = 250

let userMsgCounter = 0
function newUserMsgId(): string {
  return `msg-u-${++userMsgCounter}`
}

function newSessionId(): string {
  return crypto.randomUUID()
}

// Module-scoped slice state (intentionally not exposed on the public
// interface). `userCancelled` distinguishes a user-pressed cancel from an
// upstream "abort"-named error; `activeDeferTimer` lets a session change
// abort the deferred settle that's waiting for trailing IPC events.
let userCancelled = false
let activeDeferTimer: ReturnType<typeof setTimeout> | null = null

function clearDeferTimer(): void {
  if (activeDeferTimer) {
    clearTimeout(activeDeferTimer)
    activeDeferTimer = null
  }
}

/**
 * Named branch of `settle`: an `aiChat` response that returned successfully
 * with no streamed content. Most commonly happens when an image attachment
 * is sent to a model that does not handle vision input — the call 200s with
 * an empty stream. The hint text differs depending on whether the user has
 * an attachment and whether the host is the managed projectrose endpoint.
 *
 * Returns `null` when the response was non-empty (no error message needed).
 */
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

/**
 * Unified chat slice. PRD `chat-turn-unification` introduces this as the
 * single named entry point for chat state and actions on the renderer side.
 * The four legacy stores (`useChatTimelineStore`, `useChatUIStore`,
 * `useSessionsStore`, `useCompressionStore`) remain the canonical owners
 * of state; the slice mirrors their state via `subscribe` and surfaces a
 * unified action API. Issue #9 folded the `sendMessage` orchestration
 * (empty-response detection, post-resolution defer, model fallback notify)
 * into `send()` so callers no longer have to import from `chatTurn.ts`.
 */
export interface UseChatSlice {
  // ── State (mirrored from the four legacy stores) ─────────────────────

  // Timeline state
  messages: ChatMessage[]
  isLoading: boolean
  assistantPlaceholderId: string | null

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

  // ── Public actions ──────────────────────────────────────────────────

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
}

function snapshot(): Pick<
  UseChatSlice,
  | 'messages'
  | 'isLoading'
  | 'assistantPlaceholderId'
  | 'inputValue'
  | 'isRecording'
  | 'searchQuery'
  | 'sessions'
  | 'currentSessionId'
  | 'compressedMessages'
  | 'compressedFromCount'
  | 'compressedFromRawCount'
  | 'compressedAt'
  | 'contextStatus'
  | 'toastDismissed'
  | 'isCompressing'
> {
  const timeline = useChatTimelineStore.getState()
  const ui = useChatUIStore.getState()
  const sessions = useSessionsStore.getState()
  const compression = useCompressionStore.getState()
  return {
    messages: timeline.messages,
    isLoading: timeline.isLoading,
    assistantPlaceholderId: timeline.assistantPlaceholderId,
    inputValue: ui.inputValue,
    isRecording: ui.isRecording,
    searchQuery: ui.searchQuery,
    sessions: sessions.sessions,
    currentSessionId: sessions.currentSessionId,
    compressedMessages: compression.compressedMessages,
    compressedFromCount: compression.compressedFromCount,
    compressedFromRawCount: compression.compressedFromRawCount,
    compressedAt: compression.compressedAt,
    contextStatus: compression.contextStatus,
    toastDismissed: compression.toastDismissed,
    isCompressing: compression.isCompressing,
  }
}

async function sendImpl(): Promise<void> {
  const { inputValue } = useChatUIStore.getState()
  const trimmed = inputValue.trim()
  const timeline = useChatTimelineStore.getState()
  if (!trimmed || timeline.isLoading) return

  const rootPath = useProjectStore.getState().rootPath
  if (!rootPath) return

  userCancelled = false

  // Snapshot API messages before adding the new user message.
  const includeThinking = useSettingsStore.getState().includeThinkingInContext
  const compression = useCompressionStore.getState()
  const compressionSnapshot =
    compression.compressedMessages && compression.compressedFromCount != null
      ? {
          compressedMessages: compression.compressedMessages,
          compressedFromCount: compression.compressedFromCount,
        }
      : null

  const baseApiMessages = buildApiMessages(timeline.messages, includeThinking)
  const apiMessages = substituteCompressionSnapshot(baseApiMessages, compressionSnapshot)

  const frame = await useScreenWebcamShare.getState().captureFrame()

  const userMsg: UserMessage = {
    id: newUserMsgId(),
    role: 'user',
    content: trimmed,
    timestamp: Date.now(),
    ...(frame ? { attachments: [frame] } : {}),
  }

  // Resolve / create session, capturing the metadata that the rest of this
  // turn will write to — even if the user switches sessions mid-stream.
  let sessionId = useSessionsStore.getState().currentSessionId
  let sessionMeta = sessionId
    ? useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
    : undefined
  if (!sessionId || !sessionMeta) {
    sessionId = newSessionId()
    const now = Date.now()
    sessionMeta = { id: sessionId, title: trimmed.slice(0, 50), createdAt: now, updatedAt: now }
    useSessionsStore.getState().upsertSession(sessionMeta)
    useSessionsStore.getState().setCurrentSessionId(sessionId)
  }

  useChatUIStore.getState().setInputValue('')
  useChatTimelineStore.getState().startTurn(userMsg)
  persistSession(rootPath, sessionMeta)

  // Wire up streaming listeners. Every payload carries a `sessionId`. If
  // the user switches sessions mid-stream, events from the abandoned
  // session are still in flight on the IPC channel and would land on the
  // new session's timeline. Filtering by the sessionId captured when this
  // turn was issued drops those late events at the listener boundary.
  const t = (): ReturnType<typeof useChatTimelineStore.getState> =>
    useChatTimelineStore.getState()
  const turnSessionId = sessionId
  const forThisTurn = <T extends { sessionId: string }>(handler: (d: T) => void) =>
    (d: T): void => {
      if (d.sessionId !== turnSessionId) return
      handler(d)
    }
  const cleanupToken = window.api.onAiToken(forThisTurn((d) => t().appendToken(d)))
  const cleanupToolStart = window.api.onAiToolCallStart(forThisTurn((d) => t().appendToolStart(d)))
  const cleanupToolEnd = window.api.onAiToolCallEnd(forThisTurn((d) => t().resolveToolEnd(d)))
  const cleanupThinking = window.api.onAiThinking(forThisTurn((d) => t().appendThinking(d)))
  const cleanupAskUser = window.api.onAiAskUser(forThisTurn((d) => t().appendAskUser(d)))
  const cleanupInjected = window.api.onAiInjectedMessage(forThisTurn((d) => t().appendInjectedMessage(d)))
  const cleanupModelSelected = window.api.onAiModelSelected(forThisTurn((d) => t().modelSelected(d)))
  const cleanupStreamReset = window.api.onAiStreamReset(forThisTurn((d) => t().streamReset(d)))

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
      const finalState = useChatTimelineStore.getState()
      const lastMsg = finalState.messages[finalState.messages.length - 1]
      const emptyError = detectEmptyResponseError({
        response,
        lastMessageId: lastMsg?.id,
        userMsg,
        hasAttachment: (userMsg.attachments?.length ?? 0) > 0,
        isManaged: useSettingsStore.getState().hostMode === 'projectrose',
      })
      if (emptyError) {
        finalState.errorCleanup({ errorContent: emptyError })
      } else {
        finalState.settleTurn({ modelDisplay: response.modelDisplay })
      }
      useSessionsStore.getState().touchSession(sessionId)
      // Re-read meta so the persisted updatedAt matches what touchSession set.
      const updatedMeta =
        useSessionsStore.getState().sessions.find((s) => s.id === sessionId) ?? sessionMeta!
      persistSession(rootPath, updatedMeta)

      // Refresh after each settled turn so the toast can fire when usage
      // crosses the threshold. Failures are swallowed — status is best-effort.
      useCompressionStore
        .getState()
        .refreshContextStatus(rootPath)
        .catch(() => {
          /* ignore */
        })

      if (response.modifiedFiles.length > 0) {
        useProjectStore.getState().refreshTree()
      }
    }, POST_RESOLUTION_DEFER_MS)
  } catch (err) {
    // Capture the flag now — by the time the setTimeout fires, another
    // send() call could theoretically have reset it.
    const wasUserCancelled = userCancelled
    // Defer the same way as the success path so streaming events that arrived
    // before the error can still land on the right placeholder.
    clearDeferTimer()
    activeDeferTimer = setTimeout(() => {
      activeDeferTimer = null
      cleanup()
      const isAbort =
        wasUserCancelled || (err instanceof Error && err.name === 'AbortError')
      if (isAbort) {
        useChatTimelineStore.getState().abortCleanup()
      } else {
        const errorContent = `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`
        useChatTimelineStore.getState().errorCleanup({ errorContent })
      }
      persistSession(rootPath, sessionMeta!)
    }, POST_RESOLUTION_DEFER_MS)
  }
}

async function cancelImpl(): Promise<void> {
  userCancelled = true
  // Route the cancel by sessionId so it only affects the user's current
  // chat. Without this, a stray cancel could (in a future multi-session
  // world) abort an unrelated backgrounded turn that happened to be the
  // most recent.
  const sessionId = useSessionsStore.getState().currentSessionId
  if (!sessionId) return
  await window.api.aiCancelGeneration(sessionId)
}

async function answerAskUserImpl(questionId: string, answer: string): Promise<void> {
  useChatTimelineStore.getState().applyAnswer({ questionId, answer })
  const sessionId = useSessionsStore.getState().currentSessionId
  if (!sessionId) return
  await window.api.aiAskUserResponse(sessionId, questionId, answer)
}

function newSessionImpl(): void {
  clearDeferTimer()
  useSessionsStore.getState().setCurrentSessionId(null)
  useChatTimelineStore.getState().resetTimeline()
  useCompressionStore.getState().reset()
}

async function loadSessionsImpl(rootPath: string): Promise<void> {
  await loadAllSessions(rootPath)
  if (useSessionsStore.getState().currentSessionId) {
    await useCompressionStore
      .getState()
      .refreshContextStatus(rootPath)
      .catch(() => {
        /* ignore */
      })
  }
}

async function switchSessionImpl(rootPath: string, sessionId: string): Promise<void> {
  await loadSessionInto(rootPath, sessionId)
  await useCompressionStore
    .getState()
    .refreshContextStatus(rootPath)
    .catch(() => {
      /* ignore */
    })
}

function clearForProjectSwitchImpl(): void {
  clearDeferTimer()
  useChatTimelineStore.getState().resetTimeline()
  useSessionsStore.getState().setSessions([])
  useSessionsStore.getState().setCurrentSessionId(null)
  useCompressionStore.getState().reset()
}

export const useChat = create<UseChatSlice>((set) => {
  // Mirror each legacy store. Each `subscribe` fires when ANY part of that
  // store changes; the slice re-reads the union snapshot so projections
  // (messages, isLoading, etc.) stay coherent. Cheap because Zustand
  // listeners are synchronous and the slice only stores references, not
  // deep copies.
  const refresh = (): void => set(snapshot())
  useChatTimelineStore.subscribe(refresh)
  useChatUIStore.subscribe(refresh)
  useSessionsStore.subscribe(refresh)
  useCompressionStore.subscribe(refresh)

  return {
    ...snapshot(),

    send: () => sendImpl(),
    cancel: () => cancelImpl(),
    answerAskUser: (questionId, answer) => answerAskUserImpl(questionId, answer),
    setInputValue: (value) => useChatUIStore.getState().setInputValue(value),
    setIsRecording: (value) => useChatUIStore.getState().setIsRecording(value),
    setSearchQuery: (value) => useChatUIStore.getState().setSearchQuery(value),

    compressNow: async () => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await useCompressionStore.getState().compress(rootPath)
    },
    dismissCompressionToast: () => useCompressionStore.getState().dismissToast(),

    newSession: () => newSessionImpl(),
    loadSessions: async () => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await loadSessionsImpl(rootPath)
    },
    switchSession: async (id) => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await switchSessionImpl(rootPath, id)
    },
    deleteSession: async (id) => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await deleteSessionFor(rootPath, id)
    },
    renameSession: async (id, title) => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await renameSessionFor(rootPath, id, title)
    },

    refreshContextStatus: async () => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await useCompressionStore.getState().refreshContextStatus(rootPath)
    },

    clearForProjectSwitch: () => clearForProjectSwitchImpl(),
  }
})

/**
 * One-stop selector for the compression toast: composes the slice's
 * `contextStatus` + `toastDismissed` with the user-configurable token
 * threshold in `useSettingsStore`. Exported here so the toast component
 * does not have to import from `useCompressionStore` directly during
 * the migration phase.
 */
export function useShouldShowToast(): boolean {
  const status = useChat((s) => s.contextStatus)
  const dismissed = useChat((s) => s.toastDismissed)
  const tokenThresholdPct = useSettingsStore((s) => s.compressionThresholdPct)
  return evaluateShouldShowToast(status, dismissed, tokenThresholdPct)
}
