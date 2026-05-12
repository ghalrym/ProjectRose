import { describe, it, expect } from 'vitest'
import {
  shouldShowCompressionToast,
  TOOL_STEP_THRESHOLD,
  REDISPLAY_PCT_DELTA,
  REDISPLAY_TOOL_DELTA,
} from '../compressionToast'
import type { ContextStatus } from '../../types/chatMessages'

function status(percentUsed: number, totalToolSteps: number): ContextStatus {
  return { percentUsed, totalToolSteps, estimatedTokens: 0, contextLength: 0 }
}

describe('shouldShowCompressionToast', () => {
  it('returns false when status is null', () => {
    expect(shouldShowCompressionToast(null, null, 0.7)).toBe(false)
  })

  it('returns false when below both thresholds', () => {
    expect(shouldShowCompressionToast(status(0.5, 10), null, 0.7)).toBe(false)
  })

  it('returns true when token-percent crosses the threshold', () => {
    expect(shouldShowCompressionToast(status(0.7, 0), null, 0.7)).toBe(true)
    expect(shouldShowCompressionToast(status(0.95, 0), null, 0.7)).toBe(true)
  })

  it('returns true when tool-step count crosses the threshold', () => {
    expect(shouldShowCompressionToast(status(0.1, TOOL_STEP_THRESHOLD), null, 0.7)).toBe(true)
    expect(shouldShowCompressionToast(status(0.1, TOOL_STEP_THRESHOLD + 5), null, 0.7)).toBe(true)
  })

  it('clamps the token threshold to a [0.05, 1] range', () => {
    // Threshold below 0.05 should be clamped up
    expect(shouldShowCompressionToast(status(0.04, 0), null, 0.0)).toBe(false)
    expect(shouldShowCompressionToast(status(0.06, 0), null, 0.0)).toBe(true)
    // Threshold above 1 should be clamped down
    expect(shouldShowCompressionToast(status(1.0, 0), null, 5.0)).toBe(true)
  })

  describe('hysteresis after dismiss', () => {
    it('keeps the toast hidden when usage is unchanged after dismiss', () => {
      expect(
        shouldShowCompressionToast(
          status(0.75, 30),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(false)
    })

    it('re-shows after percent grows by REDISPLAY_PCT_DELTA', () => {
      // Use a slightly-over value to avoid IEEE 754 representation surprises:
      // 0.75 + 0.10 doesn't equal 0.85 in floating-point land.
      expect(
        shouldShowCompressionToast(
          status(0.75 + REDISPLAY_PCT_DELTA + 0.001, 30),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(true)
    })

    it('re-shows after tool-step count grows by REDISPLAY_TOOL_DELTA', () => {
      expect(
        shouldShowCompressionToast(
          status(0.75, 30 + REDISPLAY_TOOL_DELTA),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(true)
    })

    it('does not re-show for sub-threshold growth', () => {
      expect(
        shouldShowCompressionToast(
          status(0.75 + REDISPLAY_PCT_DELTA - 0.001, 30 + REDISPLAY_TOOL_DELTA - 1),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(false)
    })

    it('still hides when neither threshold is crossed regardless of dismiss', () => {
      expect(
        shouldShowCompressionToast(
          status(0.3, 5),
          { percentUsed: 0.2, totalToolSteps: 0 },
          0.7
        )
      ).toBe(false)
    })
  })
})
