import { create } from 'zustand'
import type { ContextStatus, CompressionSnapshot } from '../types/chatMessages'
import { useSettingsStore } from './useSettingsStore'

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
