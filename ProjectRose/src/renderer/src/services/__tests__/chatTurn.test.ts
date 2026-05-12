import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the screen-webcam hook before importing chatTurn. The real hook touches
// HTMLVideoElement and MediaStream which don't exist in node.
import type { MessageAttachment } from '@shared/roseModelTypes'
const captureFrame = vi.fn<() => Promise<MessageAttachment | null>>(async () => null)
vi.mock('../../hooks/useScreenWebcamShare', () => ({
  useScreenWebcamShare: {
    getState: () => ({ captureFrame }),
  },
}))

import {
  sendMessage,
  cancelGeneration,
  answerAskUser,
  refreshContextStatus,
  compressNow,
  newSession,
  clearChatForProjectSwitch,
} from '../chatTurn'
import { useChatTimelineStore } from '../../stores/useChatTimelineStore'
import { useChatUIStore } from '../../stores/useChatUIStore'
import { useCompressionStore } from '../../stores/useCompressionStore'
import { useSessionsStore } from '../../stores/useSessionsStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { emptyTimeline } from '../chatTimelineReducers'
import type { AssistantMessage } from '../../types/chatMessages'

// Hand-rolled window.api stubs — track calls and let individual tests override
// the resolve/reject behavior per-test.
interface ApiStub {
  aiChat: ReturnType<typeof vi.fn>
  aiCancelGeneration: ReturnType<typeof vi.fn>
  aiAskUserResponse: ReturnType<typeof vi.fn>
  aiContextStatus: ReturnType<typeof vi.fn>
  aiCompressToolNoise: ReturnType<typeof vi.fn>
  onAiToken: ReturnType<typeof vi.fn>
  onAiToolCallStart: ReturnType<typeof vi.fn>
  onAiToolCallEnd: ReturnType<typeof vi.fn>
  onAiThinking: ReturnType<typeof vi.fn>
  onAiAskUser: ReturnType<typeof vi.fn>
  onAiInjectedMessage: ReturnType<typeof vi.fn>
  onAiModelSelected: ReturnType<typeof vi.fn>
  onAiStreamReset: ReturnType<typeof vi.fn>
  session: {
    save: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
}

function makeApi(): ApiStub {
  const noopUnsub = (): void => {}
  return {
    aiChat: vi.fn(async () => ({ content: 'reply', modifiedFiles: [], modelDisplay: 'gpt-5' })),
    aiCancelGeneration: vi.fn(async () => {}),
    aiAskUserResponse: vi.fn(async () => {}),
    aiContextStatus: vi.fn(async () => ({
      estimatedTokens: 100,
      contextLength: 8000,
      percentUsed: 0.0125,
      totalToolSteps: 0,
    })),
    aiCompressToolNoise: vi.fn(async () => ({
      compressedMessages: [{ role: 'system' as const, content: 'summary' }],
      compressedFromCount: 1,
      compressedFromRawCount: 1,
    })),
    onAiToken: vi.fn(() => noopUnsub),
    onAiToolCallStart: vi.fn(() => noopUnsub),
    onAiToolCallEnd: vi.fn(() => noopUnsub),
    onAiThinking: vi.fn(() => noopUnsub),
    onAiAskUser: vi.fn(() => noopUnsub),
    onAiInjectedMessage: vi.fn(() => noopUnsub),
    onAiModelSelected: vi.fn(() => noopUnsub),
    onAiStreamReset: vi.fn(() => noopUnsub),
    session: {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    },
  }
}

function resetStores(): void {
  useChatTimelineStore.setState({ ...emptyTimeline })
  useChatUIStore.setState({ inputValue: '', isRecording: false, searchQuery: '' })
  useCompressionStore.setState({
    compressedMessages: null,
    compressedFromCount: null,
    compressedFromRawCount: null,
    compressedAt: null,
    contextStatus: null,
    compressionToastDismissed: null,
    isCompressing: false,
  })
  useSessionsStore.setState({ sessions: [], currentSessionId: null })
}

describe('chatTurn', () => {
  let api: ApiStub

  beforeEach(() => {
    api = makeApi()
    ;(globalThis as unknown as { window: { api: ApiStub } }).window = { api }
    resetStores()
    captureFrame.mockReset()
    captureFrame.mockResolvedValue(null)
    // The project store and settings store come from other modules — set the
    // values chatTurn reads via getState.
    useProjectStore.setState({ rootPath: '/proj' })
    useSettingsStore.setState({ includeThinkingInContext: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sendMessage early-returns', () => {
    it('does nothing when input is empty', async () => {
      useChatUIStore.getState().setInputValue('   ')
      await sendMessage()
      expect(api.aiChat).not.toHaveBeenCalled()
    })

    it('does nothing when already loading', async () => {
      useChatUIStore.getState().setInputValue('hello')
      useChatTimelineStore.setState({ isLoading: true })
      await sendMessage()
      expect(api.aiChat).not.toHaveBeenCalled()
    })

    it('does nothing when no project root is set', async () => {
      useChatUIStore.getState().setInputValue('hello')
      useProjectStore.setState({ rootPath: null })
      await sendMessage()
      expect(api.aiChat).not.toHaveBeenCalled()
    })
  })

  describe('sendMessage happy path', () => {
    it('creates a new session, appends the user message, and calls aiChat', async () => {
      vi.useFakeTimers()
      useChatUIStore.getState().setInputValue('hello world')

      const promise = sendMessage()
      // Let the microtask queue (frame capture) flush
      await vi.advanceTimersByTimeAsync(0)
      // aiChat should have been called immediately
      expect(api.aiChat).toHaveBeenCalledOnce()
      const [messages, rootPath] = api.aiChat.mock.calls[0]
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ role: 'user', content: 'hello world' })
      expect(rootPath).toBe('/proj')

      // A session should now exist with the trimmed input as the title
      const sessions = useSessionsStore.getState().sessions
      expect(sessions).toHaveLength(1)
      expect(sessions[0].title).toBe('hello world')
      expect(useSessionsStore.getState().currentSessionId).toBe(sessions[0].id)

      // Resolve the chat and advance the 250ms defer
      await vi.advanceTimersByTimeAsync(250)
      await promise

      // After settling, isLoading is false, message is no longer streaming
      const timeline = useChatTimelineStore.getState()
      expect(timeline.isLoading).toBe(false)
      expect(timeline.assistantPlaceholderId).toBeNull()
      // session.save should have been called at least twice (start + settle)
      expect(api.session.save).toHaveBeenCalled()
    })

    it('persists session metadata at turn start AND at turn settle', async () => {
      vi.useFakeTimers()
      useChatUIStore.getState().setInputValue('hi')

      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      const startCalls = api.session.save.mock.calls.length
      expect(startCalls).toBeGreaterThanOrEqual(1)

      await vi.advanceTimersByTimeAsync(250)
      await promise
      expect(api.session.save.mock.calls.length).toBeGreaterThan(startCalls)
    })

    it('clears the input field once the message starts sending', async () => {
      vi.useFakeTimers()
      useChatUIStore.getState().setInputValue('hello')
      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      expect(useChatUIStore.getState().inputValue).toBe('')
      await vi.advanceTimersByTimeAsync(250)
      await promise
    })

    it('writes a snapshot-based prefix into the request when compression is active', async () => {
      vi.useFakeTimers()
      // Pre-seed timeline with two non-streaming messages so the snapshot
      // prefix is intact.
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [
          { id: 'u1', role: 'user', content: 'old', timestamp: 0 },
          { id: 'a1', role: 'assistant', content: 'old-reply', timestamp: 0 },
        ],
      })
      useCompressionStore.setState({
        compressedMessages: [{ role: 'system', content: 'summary' }],
        compressedFromCount: 2,
        compressedFromRawCount: 2,
        compressedAt: 1,
        contextStatus: null,
        compressionToastDismissed: null,
        isCompressing: false,
      })
      useChatUIStore.getState().setInputValue('new turn')

      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      const sent = api.aiChat.mock.calls[0][0] as Array<{ role: string; content: string }>
      // First message should be the compression summary, last should be the new user input
      expect(sent[0]).toMatchObject({ role: 'system', content: 'summary' })
      expect(sent[sent.length - 1]).toMatchObject({ role: 'user', content: 'new turn' })
      await vi.advanceTimersByTimeAsync(250)
      await promise
    })

    it('attaches a captured frame to the user message when one is available', async () => {
      vi.useFakeTimers()
      captureFrame.mockResolvedValue({
        kind: 'screen',
        dataUrl: 'data:image/jpeg;base64,xxx',
        mimeType: 'image/jpeg',
      })
      useChatUIStore.getState().setInputValue('look at this')

      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      const sent = api.aiChat.mock.calls[0][0] as Array<{
        role: string
        content: string
        attachments?: unknown[]
      }>
      expect(sent[sent.length - 1].attachments).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(250)
      await promise
    })
  })

  describe('sendMessage error paths', () => {
    it('routes generic errors through errorCleanup', async () => {
      vi.useFakeTimers()
      api.aiChat.mockRejectedValueOnce(new Error('network down'))
      useChatUIStore.getState().setInputValue('boom')

      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(250)
      await promise

      const timeline = useChatTimelineStore.getState()
      expect(timeline.isLoading).toBe(false)
      // Either the active placeholder was rewritten or a fresh error message
      // was appended.
      const lastAssistant = timeline.messages.find(
        (m): m is AssistantMessage => m.role === 'assistant'
      )
      expect(lastAssistant?.content).toContain('Error: network down')
      expect(lastAssistant?.isError).toBe(true)
    })

    it('routes AbortError through abortCleanup (no error message appended)', async () => {
      vi.useFakeTimers()
      const abort = new Error('aborted')
      abort.name = 'AbortError'
      api.aiChat.mockRejectedValueOnce(abort)
      useChatUIStore.getState().setInputValue('cancel me')

      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(250)
      await promise

      const timeline = useChatTimelineStore.getState()
      expect(timeline.isLoading).toBe(false)
      // No error-flagged assistant message
      const errorMsg = timeline.messages.find(
        (m) => m.role === 'assistant' && (m as AssistantMessage).isError
      )
      expect(errorMsg).toBeUndefined()
    })

    it('routes errors whose message contains "abort" through abortCleanup', async () => {
      vi.useFakeTimers()
      api.aiChat.mockRejectedValueOnce(new Error('Request was aborted by client'))
      useChatUIStore.getState().setInputValue('cancel me too')

      const promise = sendMessage()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(250)
      await promise

      const errorMsg = useChatTimelineStore
        .getState()
        .messages.find((m) => m.role === 'assistant' && (m as AssistantMessage).isError)
      expect(errorMsg).toBeUndefined()
    })
  })

  describe('cancelGeneration', () => {
    it('calls window.api.aiCancelGeneration', async () => {
      await cancelGeneration()
      expect(api.aiCancelGeneration).toHaveBeenCalledOnce()
    })
  })

  describe('answerAskUser', () => {
    it('writes the answer to the timeline AND notifies the main process', async () => {
      useChatTimelineStore.getState().appendAskUser({
        questionId: 'q1',
        question: 'q?',
        options: [],
      })
      await answerAskUser('q1', 'Yes')
      const ask = useChatTimelineStore
        .getState()
        .messages.find((m) => m.role === 'ask_user')
      expect((ask as { answer?: string } | undefined)?.answer).toBe('Yes')
      expect(api.aiAskUserResponse).toHaveBeenCalledWith('q1', 'Yes')
    })
  })

  describe('refreshContextStatus', () => {
    it('does nothing and clears contextStatus when timeline is empty', async () => {
      useCompressionStore.setState({
        contextStatus: {
          estimatedTokens: 1,
          contextLength: 1,
          percentUsed: 0.5,
          totalToolSteps: 0,
        },
      })
      await refreshContextStatus('/proj')
      expect(useCompressionStore.getState().contextStatus).toBeNull()
      expect(api.aiContextStatus).not.toHaveBeenCalled()
    })

    it('calls aiContextStatus with current snapshot and writes the result', async () => {
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      })
      useCompressionStore.setState({
        compressedMessages: [{ role: 'system', content: 's' }],
        compressedFromCount: 1,
        compressedFromRawCount: 1,
        compressedAt: 1,
        contextStatus: null,
        compressionToastDismissed: null,
        isCompressing: false,
      })
      await refreshContextStatus('/proj')
      expect(api.aiContextStatus).toHaveBeenCalledOnce()
      const [rootPath, _msgs, snap] = api.aiContextStatus.mock.calls[0]
      expect(rootPath).toBe('/proj')
      expect(snap).toMatchObject({ compressedFromCount: 1, compressedFromRawCount: 1 })
      expect(useCompressionStore.getState().contextStatus).not.toBeNull()
    })
  })

  describe('compressNow', () => {
    it('returns early when no session is active', async () => {
      await compressNow('/proj')
      expect(api.aiCompressToolNoise).not.toHaveBeenCalled()
    })

    it('returns early when already compressing', async () => {
      useSessionsStore.setState({
        sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
        currentSessionId: 's1',
      })
      useCompressionStore.setState({ isCompressing: true } as Parameters<
        typeof useCompressionStore.setState
      >[0])
      await compressNow('/proj')
      expect(api.aiCompressToolNoise).not.toHaveBeenCalled()
    })

    it('saves the snapshot and resets isCompressing on success', async () => {
      useSessionsStore.setState({
        sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
        currentSessionId: 's1',
      })
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      })
      await compressNow('/proj')
      expect(api.aiCompressToolNoise).toHaveBeenCalledOnce()
      const c = useCompressionStore.getState()
      expect(c.compressedMessages).toEqual([{ role: 'system', content: 'summary' }])
      expect(c.compressedFromCount).toBe(1)
      expect(c.isCompressing).toBe(false)
      // Persistence should have been written
      expect(api.session.save).toHaveBeenCalled()
    })

    it('resets isCompressing even when the IPC call throws', async () => {
      useSessionsStore.setState({
        sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
        currentSessionId: 's1',
      })
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      })
      api.aiCompressToolNoise.mockRejectedValueOnce(new Error('compress failed'))
      await expect(compressNow('/proj')).rejects.toThrow('compress failed')
      expect(useCompressionStore.getState().isCompressing).toBe(false)
    })
  })

  describe('newSession', () => {
    it('clears currentSessionId, timeline, and compression', () => {
      useSessionsStore.setState({ currentSessionId: 's1', sessions: [] })
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
        isLoading: true,
      })
      useCompressionStore.setState({
        contextStatus: {
          estimatedTokens: 1,
          contextLength: 1,
          percentUsed: 0.5,
          totalToolSteps: 0,
        },
      })

      newSession()

      expect(useSessionsStore.getState().currentSessionId).toBeNull()
      expect(useChatTimelineStore.getState().messages).toEqual([])
      expect(useCompressionStore.getState().contextStatus).toBeNull()
    })
  })

  describe('clearChatForProjectSwitch', () => {
    it('wipes all four chat-related stores', () => {
      useSessionsStore.setState({
        sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
        currentSessionId: 's1',
      })
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      })
      useCompressionStore.setState({
        compressedMessages: [{ role: 'system', content: 's' }],
        compressedFromCount: 1,
        compressedFromRawCount: 1,
        compressedAt: 1,
        contextStatus: null,
        compressionToastDismissed: null,
        isCompressing: false,
      })

      clearChatForProjectSwitch()

      expect(useSessionsStore.getState().sessions).toEqual([])
      expect(useSessionsStore.getState().currentSessionId).toBeNull()
      expect(useChatTimelineStore.getState().messages).toEqual([])
      expect(useCompressionStore.getState().compressedMessages).toBeNull()
    })
  })
})
