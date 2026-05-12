import { describe, it, expect, beforeEach } from 'vitest'
import { useCompressionStore } from '../useCompressionStore'
import type { CompressionSnapshot } from '../../types/chatMessages'

const sampleSnapshot: CompressionSnapshot = {
  compressedMessages: [{ role: 'system', content: 'summary' }],
  compressedFromCount: 4,
  compressedFromRawCount: 7,
  compressedAt: 12345,
}

describe('useCompressionStore', () => {
  beforeEach(() => {
    useCompressionStore.setState({
      compressedMessages: null,
      compressedFromCount: null,
      compressedFromRawCount: null,
      compressedAt: null,
      contextStatus: null,
      compressionToastDismissed: null,
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
    expect(s.compressionToastDismissed).toBeNull()
  })

  describe('dismissCompressionToast', () => {
    it('snapshots the current percent/tool counts when status exists', () => {
      useCompressionStore.getState().setContextStatus({
        estimatedTokens: 1,
        contextLength: 1000,
        percentUsed: 0.83,
        totalToolSteps: 42,
      })
      useCompressionStore.getState().dismissCompressionToast()
      expect(useCompressionStore.getState().compressionToastDismissed).toEqual({
        percentUsed: 0.83,
        totalToolSteps: 42,
      })
    })

    it('is a no-op when status is null', () => {
      useCompressionStore.getState().dismissCompressionToast()
      expect(useCompressionStore.getState().compressionToastDismissed).toBeNull()
    })
  })
})
