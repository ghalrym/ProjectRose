import { create } from 'zustand'
import type { ContextStatus, CompressionSnapshot } from '../types/chatMessages'

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
  compressionToastDismissed: { percentUsed: number; totalToolSteps: number } | null
  isCompressing: boolean

  setSnapshot: (snapshot: CompressionSnapshot | null) => void
  setContextStatus: (status: ContextStatus | null) => void
  setIsCompressing: (v: boolean) => void
  setToastDismissed: (v: { percentUsed: number; totalToolSteps: number } | null) => void
  reset: () => void
  dismissCompressionToast: () => void
}

const initial = {
  compressedMessages: null,
  compressedFromCount: null,
  compressedFromRawCount: null,
  compressedAt: null,
  contextStatus: null,
  compressionToastDismissed: null,
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
  setToastDismissed: (compressionToastDismissed) => set({ compressionToastDismissed }),
  reset: () => set({ ...initial }),
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
}))
