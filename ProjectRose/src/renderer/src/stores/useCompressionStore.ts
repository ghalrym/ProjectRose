import { create } from 'zustand'
import type { ContextStatus, CompressionSnapshot } from '../types/chatMessages'
import { useSettingsStore } from './useSettingsStore'
import { useChatTimelineStore } from './useChatTimelineStore'
import { useSessionsStore } from './useSessionsStore'

// Tool-step count is fixed at 50 because it's a property of the agentic loop
// budget rather than the model.
export const TOOL_STEP_THRESHOLD = 50
// Hysteresis after dismiss: re-show only once usage has grown by 10pp OR by
// another 25 tool steps. Prevents the toast from re-appearing every turn.
export const REDISPLAY_PCT_DELTA = 0.1
export const REDISPLAY_TOOL_DELTA = 25

interface CompressionState {
  // Per-session compression snapshot — replaces the leading
  // `compressedFromCount` api-shape messages on every send until cleared or
  // replaced. Persisted in session JSON so it survives restarts.
  // `compressedFromRawCount` is the raw counterpart, used to slice the raw
  // message tail when computing post-compression context status.
  compressedMessages: CompressionSnapshot['compressedMessages'] | null
  compressedFromCount: number | null
  compressedFromRawCount: number | null
  compressedAt: number | null

  contextStatus: ContextStatus | null
  // Snapshot of {percentUsed, totalToolSteps} at dismiss time. The toast
  // re-appears only after the live values exceed this snapshot by the
  // REDISPLAY_* deltas — avoids nagging on every subsequent turn.
  toastDismissed: { percentUsed: number; totalToolSteps: number } | null
  isCompressing: boolean

  setSnapshot: (snapshot: CompressionSnapshot | null) => void
  setContextStatus: (status: ContextStatus | null) => void
  setIsCompressing: (v: boolean) => void
  setToastDismissed: (v: { percentUsed: number; totalToolSteps: number } | null) => void
  reset: () => void
  dismissToast: () => void
  refreshContextStatus: (rootPath: string) => Promise<void>
  compress: (rootPath: string) => Promise<void>
}

const initial = {
  compressedMessages: null,
  compressedFromCount: null,
  compressedFromRawCount: null,
  compressedAt: null,
  contextStatus: null,
  toastDismissed: null,
  isCompressing: false,
}

export const useCompressionStore = create<CompressionState>((set, get) => ({
  ...initial,
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
  reset: () => set({ ...initial }),
  dismissToast: () => {
    const status = get().contextStatus
    if (!status) return
    set({
      toastDismissed: {
        percentUsed: status.percentUsed,
        totalToolSteps: status.totalToolSteps,
      },
    })
  },
  refreshContextStatus: async (rootPath) => {
    const messages = useChatTimelineStore.getState().messages
    if (messages.length === 0) {
      set({ contextStatus: null })
      return
    }
    const c = get()
    const snapshot =
      c.compressedMessages && c.compressedFromCount != null && c.compressedFromRawCount != null
        ? {
            compressedMessages: c.compressedMessages,
            compressedFromCount: c.compressedFromCount,
            compressedFromRawCount: c.compressedFromRawCount,
          }
        : null
    const status = await window.api.aiContextStatus(
      rootPath,
      messages as unknown as Array<Record<string, unknown>>,
      snapshot
    )
    set({ contextStatus: status })
  },
  compress: async (rootPath) => {
    const sessionId = useSessionsStore.getState().currentSessionId
    if (!sessionId || get().isCompressing) return
    set({ isCompressing: true })
    try {
      const messages = useChatTimelineStore.getState().messages
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
        // Persistence is a chatTurn/chatPersistence concern; lazy-import to
        // avoid a circular module dependency between the slice and the
        // services layer. The slice owns compression state; persistence owns
        // session JSON.
        const { persistCurrentSession } = await import('../services/chatPersistence')
        persistCurrentSession(rootPath)
        // Recompute status against the new snapshot, then snap the dismiss
        // baseline to it. If post-compression usage is below threshold the
        // toast hides naturally; if it isn't (recent turns alone exceed it),
        // the snap suppresses the toast until usage grows by REDISPLAY_*
        // deltas. Either way we don't immediately re-fire the toast at the
        // exact level the user just acted on.
        await get().refreshContextStatus(rootPath)
        const fresh = get().contextStatus
        get().setToastDismissed(
          fresh ? { percentUsed: fresh.percentUsed, totalToolSteps: fresh.totalToolSteps } : null
        )
      }
    } finally {
      set({ isCompressing: false })
    }
  },
}))

// Pure threshold + hysteresis predicate. Exported for tests and for the
// `shouldShowToast` selector below.
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

// One-stop selector for the toast: subscribes to contextStatus +
// toastDismissed on this slice and compressionThresholdPct on
// useSettingsStore, then composes them through `evaluateShouldShowToast`.
// CompressionToast.tsx reads this single boolean instead of computing it from
// three independent subscriptions.
export function useShouldShowToast(): boolean {
  const status = useCompressionStore((s) => s.contextStatus)
  const dismissed = useCompressionStore((s) => s.toastDismissed)
  const tokenThresholdPct = useSettingsStore((s) => s.compressionThresholdPct)
  return evaluateShouldShowToast(status, dismissed, tokenThresholdPct)
}
