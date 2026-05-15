import { create } from 'zustand'
import type { ChatMessage, SessionMeta, ContextStatus, CompressionSnapshot } from '../types/chatMessages'
import { useChatTimelineStore } from './useChatTimelineStore'
import { useChatUIStore } from './useChatUIStore'
import { useSessionsStore } from './useSessionsStore'
import { useCompressionStore, evaluateShouldShowToast } from './useCompressionStore'
import { useProjectStore } from './useProjectStore'
import { useSettingsStore } from './useSettingsStore'
import {
  sendMessage as chatTurnSend,
  cancelGeneration as chatTurnCancel,
  answerAskUser as chatTurnAnswerAskUser,
  newSession as chatTurnNewSession,
  loadSessions as chatTurnLoadSessions,
  switchSession as chatTurnSwitchSession,
  deleteSession as chatTurnDeleteSession,
  renameSession as chatTurnRenameSession,
  clearChatForProjectSwitch as chatTurnClearForProjectSwitch,
} from '../services/chatTurn'

/**
 * Unified chat slice. PRD `chat-turn-unification` introduces this as the
 * single named entry point for chat state and actions on the renderer
 * side. During the adapter phase (issue #6) the four legacy stores
 * (`useChatTimelineStore`, `useChatUIStore`, `useSessionsStore`,
 * `useCompressionStore`) remain the canonical owners of state; the
 * slice mirrors their state via `subscribe` and forwards actions to
 * the existing `chatTurn.ts` orchestration functions. Later issues
 * migrate consumers off the four stores; the slice becomes primary
 * after the last consumer moves.
 *
 * Method names match the PRD's public surface so components migrating
 * off the legacy stores see a stable API.
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

    send: () => chatTurnSend(),
    cancel: () => chatTurnCancel(),
    answerAskUser: (questionId, answer) => chatTurnAnswerAskUser(questionId, answer),
    setInputValue: (value) => useChatUIStore.getState().setInputValue(value),
    setIsRecording: (value) => useChatUIStore.getState().setIsRecording(value),
    setSearchQuery: (value) => useChatUIStore.getState().setSearchQuery(value),

    compressNow: async () => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await useCompressionStore.getState().compress(rootPath)
    },
    dismissCompressionToast: () => useCompressionStore.getState().dismissToast(),

    newSession: () => chatTurnNewSession(),
    loadSessions: async () => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await chatTurnLoadSessions(rootPath)
    },
    switchSession: async (id) => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await chatTurnSwitchSession(rootPath, id)
    },
    deleteSession: async (id) => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await chatTurnDeleteSession(rootPath, id)
    },
    renameSession: async (id, title) => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await chatTurnRenameSession(rootPath, id, title)
    },

    refreshContextStatus: async () => {
      const rootPath = useProjectStore.getState().rootPath
      if (!rootPath) return
      await useCompressionStore.getState().refreshContextStatus(rootPath)
    },

    clearForProjectSwitch: () => chatTurnClearForProjectSwitch(),
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
