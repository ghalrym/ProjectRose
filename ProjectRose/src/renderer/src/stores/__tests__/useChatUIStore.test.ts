import { describe, it, expect, beforeEach } from 'vitest'
import { useChatUIStore } from '../useChatUIStore'

describe('useChatUIStore', () => {
  beforeEach(() => {
    useChatUIStore.setState({ inputValue: '', isRecording: false, searchQuery: '' })
  })

  it('starts with empty input, not recording, no search query', () => {
    const s = useChatUIStore.getState()
    expect(s.inputValue).toBe('')
    expect(s.isRecording).toBe(false)
    expect(s.searchQuery).toBe('')
  })

  it('setInputValue updates only inputValue', () => {
    useChatUIStore.getState().setIsRecording(true)
    useChatUIStore.getState().setInputValue('hello')
    expect(useChatUIStore.getState().inputValue).toBe('hello')
    expect(useChatUIStore.getState().isRecording).toBe(true)
  })

  it('setIsRecording toggles recording state', () => {
    useChatUIStore.getState().setIsRecording(true)
    expect(useChatUIStore.getState().isRecording).toBe(true)
    useChatUIStore.getState().setIsRecording(false)
    expect(useChatUIStore.getState().isRecording).toBe(false)
  })

  it('setSearchQuery updates only searchQuery', () => {
    useChatUIStore.getState().setInputValue('draft')
    useChatUIStore.getState().setSearchQuery('bug')
    expect(useChatUIStore.getState().searchQuery).toBe('bug')
    expect(useChatUIStore.getState().inputValue).toBe('draft')
  })
})
