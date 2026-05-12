import type { ContextStatus } from '../types/chatMessages'

// Tool-step count is fixed at 50 because it's a property of the agentic loop
// budget rather than the model.
export const TOOL_STEP_THRESHOLD = 50
// Hysteresis after dismiss: re-show only once usage has grown by 10pp OR by
// another 25 tool steps. Prevents the toast from re-appearing every turn.
export const REDISPLAY_PCT_DELTA = 0.10
export const REDISPLAY_TOOL_DELTA = 25

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
