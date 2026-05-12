import { describe, it, expect, beforeEach } from 'vitest'
import { useChatTimelineStore } from '../useChatTimelineStore'
import { emptyTimeline } from '../../services/chatTimelineReducers'
import type { AssistantMessage, ThinkingMessage, UserMessage, AskUserMessage } from '../../types/chatMessages'

describe('useChatTimelineStore', () => {
  beforeEach(() => {
    useChatTimelineStore.setState({ ...emptyTimeline })
  })

  it('appendToken creates an assistant placeholder when none is active', () => {
    useChatTimelineStore.getState().appendToken({ token: 'Hi' })
    const s = useChatTimelineStore.getState()
    expect(s.messages).toHaveLength(1)
    expect(s.assistantPlaceholderId).not.toBeNull()
    expect((s.messages[0] as AssistantMessage).content).toBe('Hi')
    expect((s.messages[0] as AssistantMessage).streaming).toBe(true)
  })

  it('appendToken extends the active placeholder', () => {
    useChatTimelineStore.getState().appendToken({ token: 'Hi' })
    useChatTimelineStore.getState().appendToken({ token: ' there' })
    expect(useChatTimelineStore.getState().messages).toHaveLength(1)
    expect((useChatTimelineStore.getState().messages[0] as AssistantMessage).content).toBe(
      'Hi there'
    )
  })

  it('appendToolStart seals streaming and inserts a tool', () => {
    useChatTimelineStore.getState().appendToken({ token: 'partial' })
    useChatTimelineStore
      .getState()
      .appendToolStart({ id: 'tool-1', name: 'grep', params: { p: 'x' } })
    const s = useChatTimelineStore.getState()
    expect(s.messages).toHaveLength(2)
    expect((s.messages[0] as AssistantMessage).streaming).toBe(false)
    expect(s.assistantPlaceholderId).toBeNull()
    expect(s.messages[1]).toMatchObject({
      role: 'tool',
      toolId: 'tool-1',
      pending: true,
    })
  })

  it('resolveToolEnd transitions the matching tool from pending to resolved', () => {
    useChatTimelineStore
      .getState()
      .appendToolStart({ id: 'tool-1', name: 'g', params: {} })
    useChatTimelineStore.getState().resolveToolEnd({ id: 'tool-1', result: 'ok', error: false })
    const s = useChatTimelineStore.getState()
    expect(s.messages[0]).toMatchObject({ role: 'tool', pending: false, result: 'ok' })
  })

  it('appendThinking inserts before the active assistant placeholder', () => {
    useChatTimelineStore.getState().appendToken({ token: 'partial' })
    useChatTimelineStore.getState().appendThinking({ content: 'pondering' })
    const s = useChatTimelineStore.getState()
    expect(s.messages.map((m) => m.role)).toEqual(['thinking', 'assistant'])
    expect(s.thinkingPlaceholderId).not.toBeNull()
  })

  it('appendAskUser seals streaming and appends a pending question', () => {
    useChatTimelineStore.getState().appendToken({ token: 'partial' })
    useChatTimelineStore.getState().appendAskUser({
      questionId: 'q1',
      question: 'Proceed?',
      options: ['Yes', 'No'],
    })
    const s = useChatTimelineStore.getState()
    expect(s.assistantPlaceholderId).toBeNull()
    const ask = s.messages[s.messages.length - 1] as AskUserMessage
    expect(ask).toMatchObject({
      role: 'ask_user',
      questionId: 'q1',
      options: ['Yes', 'No'],
      answer: null,
    })
  })

  it('applyAnswer fills in the matching question', () => {
    useChatTimelineStore.getState().appendAskUser({
      questionId: 'q1',
      question: 'Proceed?',
      options: [],
    })
    useChatTimelineStore.getState().applyAnswer({ questionId: 'q1', answer: 'Yes' })
    const ask = useChatTimelineStore.getState().messages[0] as AskUserMessage
    expect(ask.answer).toBe('Yes')
  })

  it('startTurn appends a user message and sets isLoading', () => {
    const userMsg: UserMessage = { id: 'u1', role: 'user', content: 'hi', timestamp: 0 }
    useChatTimelineStore.getState().startTurn(userMsg)
    const s = useChatTimelineStore.getState()
    expect(s.messages).toEqual([userMsg])
    expect(s.isLoading).toBe(true)
  })

  it('settleTurn seals and clears placeholders', () => {
    useChatTimelineStore.getState().appendToken({ token: 'done' })
    useChatTimelineStore.getState().settleTurn({ modelDisplay: 'gpt-5' })
    const s = useChatTimelineStore.getState()
    expect(s.isLoading).toBe(false)
    expect(s.assistantPlaceholderId).toBeNull()
    expect((s.messages[0] as AssistantMessage).streaming).toBe(false)
    expect((s.messages[0] as AssistantMessage).modelDisplay).toBe('gpt-5')
  })

  it('abortCleanup seals streaming and cancels unanswered asks', () => {
    useChatTimelineStore.getState().appendToken({ token: 'partial' })
    useChatTimelineStore.getState().appendAskUser({
      questionId: 'q1',
      question: 'q',
      options: [],
    })
    useChatTimelineStore.getState().abortCleanup()
    const s = useChatTimelineStore.getState()
    const ask = s.messages.find((m) => m.role === 'ask_user') as AskUserMessage
    expect(ask.answer).toBe('[cancelled]')
    expect(s.isLoading).toBe(false)
  })

  it('errorCleanup replaces the active placeholder with the error', () => {
    useChatTimelineStore.getState().appendToken({ token: 'partial' })
    useChatTimelineStore.getState().errorCleanup({ errorContent: 'Error: x' })
    const s = useChatTimelineStore.getState()
    expect((s.messages[0] as AssistantMessage).content).toBe('Error: x')
    expect((s.messages[0] as AssistantMessage).isError).toBe(true)
    expect(s.isLoading).toBe(false)
  })

  it('errorCleanup appends a fresh error message when no placeholder exists', () => {
    useChatTimelineStore.getState().setIsLoading(true)
    useChatTimelineStore.getState().errorCleanup({ errorContent: 'Error: y' })
    const s = useChatTimelineStore.getState()
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toMatchObject({ role: 'assistant', content: 'Error: y', isError: true })
  })

  it('streamReset wipes the placeholder content and adds a fallback notice', () => {
    useChatTimelineStore.getState().appendToken({ token: 'try' })
    useChatTimelineStore.getState().modelSelected({ modelDisplay: 'primary' })
    useChatTimelineStore
      .getState()
      .streamReset({ fallbackModel: 'backup', errorMessage: '429' })
    const s = useChatTimelineStore.getState()
    expect((s.messages[0] as AssistantMessage).content).toBe('')
    expect((s.messages[0] as AssistantMessage).modelDisplay).toBe('backup')
    expect((s.messages[0] as AssistantMessage).fallbackNotice).toBe('primary failed: 429')
  })

  it('modelSelected stages pendingModelDisplay when no placeholder is active', () => {
    useChatTimelineStore.getState().modelSelected({ modelDisplay: 'claude' })
    expect(useChatTimelineStore.getState().pendingModelDisplay).toBe('claude')
  })

  it('appendThinking extends an existing thinking placeholder', () => {
    useChatTimelineStore.getState().appendThinking({ content: 'first' })
    useChatTimelineStore.getState().appendThinking({ content: ' second' })
    const s = useChatTimelineStore.getState()
    expect(s.messages).toHaveLength(1)
    expect((s.messages[0] as ThinkingMessage).content).toBe('first second')
  })

  it('resetTimeline clears all timeline state', () => {
    useChatTimelineStore.getState().appendToken({ token: 'partial' })
    useChatTimelineStore.getState().setIsLoading(true)
    useChatTimelineStore.getState().resetTimeline()
    expect(useChatTimelineStore.getState()).toMatchObject({
      messages: [],
      assistantPlaceholderId: null,
      thinkingPlaceholderId: null,
      pendingModelDisplay: null,
      isLoading: false,
    })
  })

  it('appendToolStart, appendThinking, etc. all generate distinct message ids', () => {
    useChatTimelineStore.getState().appendToken({ token: 'x' })
    useChatTimelineStore.getState().appendToolStart({ id: 't1', name: 'g', params: {} })
    useChatTimelineStore.getState().appendToken({ token: 'y' })
    useChatTimelineStore.getState().appendToolStart({ id: 't2', name: 'g', params: {} })
    const ids = useChatTimelineStore.getState().messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
