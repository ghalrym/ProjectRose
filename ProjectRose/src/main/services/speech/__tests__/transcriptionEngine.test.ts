import { describe, it, expect } from 'vitest'
import {
  rms,
  isSilentOrHallucination,
  SILENCE_RMS_THRESHOLD
} from '../transcriptionEngine'

describe('rms', () => {
  it('returns 0 for an all-zero buffer', () => {
    const pcm = new Float32Array(1024)
    expect(rms(pcm)).toBe(0)
  })

  it('returns 1 for an all-one buffer', () => {
    const pcm = new Float32Array(1024).fill(1)
    expect(rms(pcm)).toBeCloseTo(1, 5)
  })

  it('treats sub-threshold buffers as silence', () => {
    const pcm = new Float32Array(1024).fill(0.001)
    expect(rms(pcm)).toBeLessThan(SILENCE_RMS_THRESHOLD)
  })
})

describe('isSilentOrHallucination', () => {
  it('flags whisper-style bracketed annotations', () => {
    expect(isSilentOrHallucination('[Music]')).toBe(true)
    expect(isSilentOrHallucination('(piano music)')).toBe(true)
  })

  it('flags common "thank you" hallucinations', () => {
    expect(isSilentOrHallucination('Thank you')).toBe(true)
    expect(isSilentOrHallucination('thanks for watching')).toBe(true)
    expect(isSilentOrHallucination('you')).toBe(true)
  })

  it('flags empty or punctuation-only output', () => {
    expect(isSilentOrHallucination('')).toBe(true)
    expect(isSilentOrHallucination('...')).toBe(true)
    expect(isSilentOrHallucination('  !? ')).toBe(true)
  })

  it('accepts normal speech', () => {
    expect(isSilentOrHallucination('hello world')).toBe(false)
    expect(isSilentOrHallucination('open the project sidebar')).toBe(false)
  })
})
