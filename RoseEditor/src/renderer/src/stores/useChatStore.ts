import { create } from 'zustand'
import { useProjectStore } from './useProjectStore'

let msgCounter = 0

interface BaseMessage {
  id: string
  timestamp: number
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  content: string
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  content: string
}

export interface ToolMessage extends BaseMessage {
  role: 'tool'
  toolId: string
  name: string
  params: Record<string, unknown>
  result: string | null
  error: boolean
  pending: boolean
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  inputValue: string
  setInputValue: (value: string) => void
  sendMessage: () => Promise<void>
  clearMessages: () => void
  appendToolStart: (data: { id: string; name: string; params: Record<string, unknown> }) => void
  resolveToolEnd: (data: { id: string; result: string; error: boolean }) => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  isLoading: false,
  inputValue: '',

  setInputValue: (value) => set({ inputValue: value }),

  appendToolStart: (data) => {
    const msg: ToolMessage = {
      id: `msg-${++msgCounter}`,
      role: 'tool',
      timestamp: Date.now(),
      toolId: data.id,
      name: data.name,
      params: data.params,
      result: null,
      error: false,
      pending: true
    }
    set((s) => ({ messages: [...s.messages, msg] }))
  },

  resolveToolEnd: (data) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.role === 'tool' && m.toolId === data.id
          ? { ...m, result: data.result, error: data.error, pending: false }
          : m
      )
    }))
  },

  sendMessage: async () => {
    const { inputValue, isLoading, messages } = get()
    const trimmed = inputValue.trim()
    if (!trimmed || isLoading) return

    const rootPath = useProjectStore.getState().rootPath
    if (!rootPath) return

    const userMsg: UserMessage = {
      id: `msg-${++msgCounter}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      inputValue: '',
      isLoading: true
    }))

    try {
      const apiMessages = [...messages, userMsg]
        .filter((m): m is UserMessage | AssistantMessage => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }))

      const response = await window.api.aiChat(apiMessages, rootPath)

      const assistantMsg: AssistantMessage = {
        id: `msg-${++msgCounter}`,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now()
      }

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isLoading: false
      }))

      if (response.modifiedFiles.length > 0) {
        useProjectStore.getState().refreshTree()
      }
    } catch (err) {
      const errorMsg: AssistantMessage = {
        id: `msg-${++msgCounter}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: Date.now()
      }

      set((s) => ({
        messages: [...s.messages, errorMsg],
        isLoading: false
      }))
    }
  },

  clearMessages: () => set({ messages: [], isLoading: false })
}))
