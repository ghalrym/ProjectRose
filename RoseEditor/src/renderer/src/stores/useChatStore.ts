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

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  inputValue: string
  currentSessionId: string | null
  sessions: SessionMeta[]
  searchQuery: string

  setInputValue: (value: string) => void
  setSearchQuery: (q: string) => void
  sendMessage: () => Promise<void>
  clearMessages: () => void
  appendToolStart: (data: { id: string; name: string; params: Record<string, unknown> }) => void
  resolveToolEnd: (data: { id: string; result: string; error: boolean }) => void

  loadSessions: (rootPath: string) => Promise<void>
  switchSession: (rootPath: string, sessionId: string) => Promise<void>
  newSession: () => void
  renameSession: (rootPath: string, sessionId: string, title: string) => Promise<void>
  deleteSession: (rootPath: string, sessionId: string) => Promise<void>
}

function generateId(): string {
  return crypto.randomUUID()
}

function persistSession(rootPath: string, sessionId: string, title: string, createdAt: number, messages: ChatMessage[]): void {
  window.api.session.save(rootPath, {
    id: sessionId,
    title,
    createdAt,
    updatedAt: Date.now(),
    messages: messages as unknown[]
  }).catch(() => { /* persistence failures are non-fatal */ })
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  isLoading: false,
  inputValue: '',
  currentSessionId: null,
  sessions: [],
  searchQuery: '',

  setInputValue: (value) => set({ inputValue: value }),
  setSearchQuery: (q) => set({ searchQuery: q }),

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

    // Create session on first message
    let sessionId = get().currentSessionId
    let sessionCreatedAt = Date.now()
    let sessionTitle = trimmed.slice(0, 50)
    const isNewSession = !sessionId

    if (isNewSession) {
      sessionId = generateId()
      set((s) => ({
        currentSessionId: sessionId,
        sessions: [{ id: sessionId!, title: sessionTitle, createdAt: sessionCreatedAt, updatedAt: sessionCreatedAt }, ...s.sessions]
      }))
    }

    const session = get().sessions.find((s) => s.id === sessionId)
    const createdAt = session?.createdAt ?? sessionCreatedAt
    const title = session?.title ?? sessionTitle

    set((s) => ({
      messages: [...s.messages, userMsg],
      inputValue: '',
      isLoading: true
    }))

    try {
      persistSession(rootPath, sessionId!, title, createdAt, get().messages)

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

      persistSession(rootPath, sessionId!, title, createdAt, get().messages)
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, updatedAt: Date.now() } : sess
        )
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

      persistSession(rootPath, sessionId!, title, createdAt, get().messages)
    }
  },

  clearMessages: () => set({ messages: [], isLoading: false }),

  loadSessions: async (rootPath) => {
    const sessions = await window.api.session.list(rootPath)
    set({ sessions: sessions as SessionMeta[] })

    if (sessions.length > 0) {
      const first = sessions[0]
      const loaded = await window.api.session.load(rootPath, first.id)
      if (loaded) {
        set({
          currentSessionId: first.id,
          messages: (loaded.messages as ChatMessage[]) ?? []
        })
      }
    }
  },

  switchSession: async (rootPath, sessionId) => {
    const loaded = await window.api.session.load(rootPath, sessionId)
    if (loaded) {
      set({
        currentSessionId: sessionId,
        messages: (loaded.messages as ChatMessage[]) ?? [],
        isLoading: false
      })
    }
  },

  newSession: () => set({ currentSessionId: null, messages: [], isLoading: false }),

  renameSession: async (rootPath, sessionId, title) => {
    const loaded = await window.api.session.load(rootPath, sessionId)
    if (!loaded) return
    await window.api.session.save(rootPath, { ...loaded, title, updatedAt: Date.now() })
    set((s) => ({
      sessions: s.sessions.map((sess) => sess.id === sessionId ? { ...sess, title } : sess)
    }))
  },

  deleteSession: async (rootPath, sessionId) => {
    await window.api.session.delete(rootPath, sessionId)
    const wasActive = get().currentSessionId === sessionId
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== sessionId) }))
    if (wasActive) get().newSession()
  }
}))
