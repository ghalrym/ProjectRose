import { create } from 'zustand'
import type { ChatMessage } from '../types/chatMessages'
import {
  applyToken,
  applyToolStart,
  applyToolEnd,
  applyThinking,
  applyAskUser,
  applyAnswerAskUser,
  applyInjectedMessage,
  applyModelSelected,
  applyStreamReset,
  applyStartTurn,
  applyTurnSettled,
  applyAbortCleanup,
  applyErrorCleanup,
  emptyTimeline,
  type TimelineSlice,
} from '../services/chatTimelineReducers'

let msgCounter = 0
function makeId(): string {
  return `msg-${++msgCounter}`
}

interface TimelineState extends TimelineSlice {
  setMessages: (messages: ChatMessage[]) => void
  resetTimeline: () => void
  clearMessages: () => void
  setIsLoading: (v: boolean) => void

  appendToken: (data: { token: string }) => void
  appendToolStart: (data: { id: string; name: string; params: Record<string, unknown> }) => void
  resolveToolEnd: (data: { id: string; result: string; error: boolean }) => void
  appendThinking: (data: { content: string }) => void
  appendAskUser: (data: { questionId: string; question: string; options: string[] }) => void
  applyAnswer: (data: { questionId: string; answer: string }) => void
  appendInjectedMessage: (data: {
    extensionId: string
    extensionName: string
    extensionIcon?: string
    content: string
  }) => void

  modelSelected: (data: { modelDisplay: string }) => void
  streamReset: (data: { fallbackModel: string; errorMessage: string }) => void

  startTurn: (userMessage: ChatMessage) => void
  settleTurn: (data: { modelDisplay: string }) => void
  abortCleanup: () => void
  errorCleanup: (data: { errorContent: string }) => void
}

export const useChatTimelineStore = create<TimelineState>((set) => ({
  ...emptyTimeline,

  setMessages: (messages) => set({ messages }),
  resetTimeline: () => set({ ...emptyTimeline }),
  clearMessages: () => set({ messages: [], isLoading: false }),
  setIsLoading: (isLoading) => set({ isLoading }),

  appendToken: (data) =>
    set((s) => applyToken(s, { token: data.token, newId: makeId(), timestamp: Date.now() })),
  appendToolStart: (data) =>
    set((s) => applyToolStart(s, { ...data, newId: makeId(), timestamp: Date.now() })),
  resolveToolEnd: (data) => set((s) => applyToolEnd(s, data)),
  appendThinking: (data) =>
    set((s) => applyThinking(s, { content: data.content, newId: makeId(), timestamp: Date.now() })),
  appendAskUser: (data) =>
    set((s) => applyAskUser(s, { ...data, newId: makeId(), timestamp: Date.now() })),
  applyAnswer: (data) => set((s) => applyAnswerAskUser(s, data)),
  appendInjectedMessage: (data) =>
    set((s) => applyInjectedMessage(s, { ...data, newId: makeId(), timestamp: Date.now() })),

  modelSelected: (data) => set((s) => applyModelSelected(s, data)),
  streamReset: (data) => set((s) => applyStreamReset(s, data)),

  startTurn: (userMessage) => set((s) => applyStartTurn(s, userMessage)),
  settleTurn: (data) => set((s) => applyTurnSettled(s, data)),
  abortCleanup: () => set((s) => applyAbortCleanup(s)),
  errorCleanup: (data) =>
    set((s) => applyErrorCleanup(s, { ...data, newId: makeId(), timestamp: Date.now() })),
}))
