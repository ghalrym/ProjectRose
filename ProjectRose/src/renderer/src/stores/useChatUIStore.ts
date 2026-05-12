import { create } from 'zustand'

interface ChatUIState {
  inputValue: string
  isRecording: boolean
  searchQuery: string
  setInputValue: (v: string) => void
  setIsRecording: (v: boolean) => void
  setSearchQuery: (q: string) => void
}

export const useChatUIStore = create<ChatUIState>((set) => ({
  inputValue: '',
  isRecording: false,
  searchQuery: '',
  setInputValue: (inputValue) => set({ inputValue }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}))
