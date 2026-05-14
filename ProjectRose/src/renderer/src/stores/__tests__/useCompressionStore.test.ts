import { describe, it, expect, beforeEach } from 'vitest'
import {
  useCompressionStore,
  evaluateShouldShowToast,
  TOOL_STEP_THRESHOLD,
  REDISPLAY_PCT_DELTA,
  REDISPLAY_TOOL_DELTA,
} from '../useCompressionStore'
import type { CompressionSnapshot, ContextStatus } from '../../types/chatMessages'

const sampleSnapshot: CompressionSnapshot = {
  compressedMessages: [{ role: 'system', content: 'summary' }],
  compressedFromCount: 4,
  compressedFromRawCount: 7,
  compressedAt: 12345,
}

function status(percentUsed: number, totalToolSteps: number): ContextStatus {
  return { percentUsed, totalToolSteps, estimatedTokens: 0, contextLength: 0 }
}

describe('useCompressionStore', () => {
  beforeEach(() => {
    useCompressionStore.setState({
      compressedMessages: null,
      compressedFromCount: null,
      compressedFromRawCount: null,
      compressedAt: null,
      contextStatus: null,
      toastDismissed: null,
      isCompressing: false,
    })
  })

  it('setSnapshot writes all four quartet fields', () => {
    useCompressionStore.getState().setSnapshot(sampleSnapshot)
    const s = useCompressionStore.getState()
    expect(s.compressedMessages).toEqual(sampleSnapshot.compressedMessages)
    expect(s.compressedFromCount).toBe(4)
    expect(s.compressedFromRawCount).toBe(7)
    expect(s.compressedAt).toBe(12345)
  })

  it('setSnapshot(null) clears all four quartet fields', () => {
    useCompressionStore.getState().setSnapshot(sampleSnapshot)
    useCompressionStore.getState().setSnapshot(null)
    const s = useCompressionStore.getState()
    expect(s.compressedMessages).toBeNull()
    expect(s.compressedFromCount).toBeNull()
    expect(s.compressedFromRawCount).toBeNull()
    expect(s.compressedAt).toBeNull()
  })

  it('reset clears everything to initial', () => {
    useCompressionStore.getState().setSnapshot(sampleSnapshot)
    useCompressionStore.getState().setContextStatus({
      estimatedTokens: 1,
      contextLength: 1000,
      percentUsed: 0.5,
      totalToolSteps: 10,
    })
    useCompressionStore.getState().setIsCompressing(true)
    useCompressionStore.getState().setToastDismissed({ percentUsed: 0.5, totalToolSteps: 5 })

    useCompressionStore.getState().reset()

    const s = useCompressionStore.getState()
    expect(s.compressedMessages).toBeNull()
    expect(s.contextStatus).toBeNull()
    expect(s.isCompressing).toBe(false)
    expect(s.toastDismissed).toBeNull()
  })

  describe('dismissToast', () => {
    it('snapshots the current percent/tool counts when status exists', () => {
      useCompressionStore.getState().setContextStatus({
        estimatedTokens: 1,
        contextLength: 1000,
        percentUsed: 0.83,
        totalToolSteps: 42,
      })
      useCompressionStore.getState().dismissToast()
      expect(useCompressionStore.getState().toastDismissed).toEqual({
        percentUsed: 0.83,
        totalToolSteps: 42,
      })
    })

    it('is a no-op when status is null', () => {
      useCompressionStore.getState().dismissToast()
      expect(useCompressionStore.getState().toastDismissed).toBeNull()
    })
  })
})

describe('evaluateShouldShowToast', () => {
  it('returns false when status is null', () => {
    expect(evaluateShouldShowToast(null, null, 0.7)).toBe(false)
  })

  it('returns false when below both thresholds', () => {
    expect(evaluateShouldShowToast(status(0.5, 10), null, 0.7)).toBe(false)
  })

  it('returns true when token-percent crosses the threshold', () => {
    expect(evaluateShouldShowToast(status(0.7, 0), null, 0.7)).toBe(true)
    expect(evaluateShouldShowToast(status(0.95, 0), null, 0.7)).toBe(true)
  })

  it('returns true when tool-step count crosses the threshold', () => {
    expect(evaluateShouldShowToast(status(0.1, TOOL_STEP_THRESHOLD), null, 0.7)).toBe(true)
    expect(evaluateShouldShowToast(status(0.1, TOOL_STEP_THRESHOLD + 5), null, 0.7)).toBe(true)
  })

  it('clamps the token threshold to a [0.05, 1] range', () => {
    // Threshold below 0.05 should be clamped up
    expect(evaluateShouldShowToast(status(0.04, 0), null, 0.0)).toBe(false)
    expect(evaluateShouldShowToast(status(0.06, 0), null, 0.0)).toBe(true)
    // Threshold above 1 should be clamped down
    expect(evaluateShouldShowToast(status(1.0, 0), null, 5.0)).toBe(true)
  })

  describe('hysteresis after dismiss', () => {
    it('keeps the toast hidden when usage is unchanged after dismiss', () => {
      expect(
        evaluateShouldShowToast(
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
        evaluateShouldShowToast(
          status(0.75 + REDISPLAY_PCT_DELTA + 0.001, 30),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(true)
    })

    it('re-shows after tool-step count grows by REDISPLAY_TOOL_DELTA', () => {
      expect(
        evaluateShouldShowToast(
          status(0.75, 30 + REDISPLAY_TOOL_DELTA),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(true)
    })

    it('does not re-show for sub-threshold growth', () => {
      expect(
        evaluateShouldShowToast(
          status(0.75 + REDISPLAY_PCT_DELTA - 0.001, 30 + REDISPLAY_TOOL_DELTA - 1),
          { percentUsed: 0.75, totalToolSteps: 30 },
          0.7
        )
      ).toBe(false)
    })

    it('still hides when neither threshold is crossed regardless of dismiss', () => {
      expect(
        evaluateShouldShowToast(
          status(0.3, 5),
          { percentUsed: 0.2, totalToolSteps: 0 },
          0.7
        )
      ).toBe(false)
    })
  })
})
