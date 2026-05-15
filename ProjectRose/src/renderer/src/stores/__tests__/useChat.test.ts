import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The chat input flow captures a frame from the screen-webcam hook before
// posting the user message. That hook reaches into HTMLVideoElement /
// MediaStream which don't exist in the test environment, so stub it.
import type { MessageAttachment } from '@shared/roseModelTypes'
const captureFrame = vi.fn<() => Promise<MessageAttachment | null>>(async () => null)
vi.mock('../../hooks/useScreenWebcamShare', () => ({
  useScreenWebcamShare: {
    getState: () => ({ captureFrame }),
  },
}))

import { useChat } from '../useChat'
import { useChatTimelineStore } from '../useChatTimelineStore'
import { useChatUIStore } from '../useChatUIStore'
import { useCompressionStore } from '../useCompressionStore'
import { useSessionsStore } from '../useSessionsStore'
import { useProjectStore } from '../useProjectStore'
import { useSettingsStore } from '../useSettingsStore'
import { emptyTimeline } from '../../services/chatTimelineReducers'

// Same hand-rolled api stubs the chatTurn tests use. Listener registrations
// return no-op unsubscribers because send() goes through the full chat-turn
// flow and chatTurn.ts wires them up.
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
    aiCompressToolNoise: vi.fn(async () => null),
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
    toastDismissed: null,
    isCompressing: false,
  })
  useSessionsStore.setState({ sessions: [], currentSessionId: null })
}

describe('useChat slice', () => {
  let api: ApiStub

  beforeEach(() => {
    api = makeApi()
    ;(globalThis as unknown as { window: { api: ApiStub } }).window = { api }
    resetStores()
    captureFrame.mockReset()
    captureFrame.mockResolvedValue(null)
    useProjectStore.setState({ rootPath: '/proj' })
    useSettingsStore.setState({ includeThinkingInContext: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('state mirroring', () => {
    it('mirrors timeline messages from useChatTimelineStore', () => {
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      })
      expect(useChat.getState().messages).toEqual([
        { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      ])
    })

    it('mirrors inputValue from useChatUIStore', () => {
      useChatUIStore.getState().setInputValue('draft text')
      expect(useChat.getState().inputValue).toBe('draft text')
    })

    it('mirrors sessions and currentSessionId from useSessionsStore', () => {
      useSessionsStore.setState({
        sessions: [{ id: 's1', title: 't1', createdAt: 0, updatedAt: 0 }],
        currentSessionId: 's1',
      })
      const slice = useChat.getState()
      expect(slice.sessions).toHaveLength(1)
      expect(slice.currentSessionId).toBe('s1')
    })

    it('mirrors compression snapshot fields from useCompressionStore', () => {
      useCompressionStore.setState({
        compressedMessages: [{ role: 'system', content: 'summary' }],
        compressedFromCount: 2,
        compressedFromRawCount: 2,
        compressedAt: 100,
        contextStatus: null,
        toastDismissed: null,
        isCompressing: false,
      })
      const slice = useChat.getState()
      expect(slice.compressedMessages).toEqual([{ role: 'system', content: 'summary' }])
      expect(slice.compressedFromCount).toBe(2)
      expect(slice.compressedAt).toBe(100)
    })
  })

  describe('actions', () => {
    it('setInputValue updates the slice (via the underlying ui store)', () => {
      useChat.getState().setInputValue('hello')
      expect(useChat.getState().inputValue).toBe('hello')
      // The legacy store also reflects the change so consumers still on it
      // continue to work during the adapter phase.
      expect(useChatUIStore.getState().inputValue).toBe('hello')
    })

    it('send() drives the same timeline transitions as the legacy chatTurn.sendMessage flow', async () => {
      vi.useFakeTimers()
      useChat.getState().setInputValue('hello world')

      const promise = useChat.getState().send()
      await vi.advanceTimersByTimeAsync(0)

      // The legacy chat-turn flow called aiChat with the user message —
      // proxy through send() and assert the same wire shape.
      expect(api.aiChat).toHaveBeenCalledOnce()
      const [messages, rootPath] = api.aiChat.mock.calls[0]
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ role: 'user', content: 'hello world' })
      expect(rootPath).toBe('/proj')

      // A session was created and reflected onto the slice via the
      // sessions-store subscription.
      expect(useChat.getState().sessions).toHaveLength(1)
      expect(useChat.getState().currentSessionId).toBe(
        useChat.getState().sessions[0].id
      )

      await vi.advanceTimersByTimeAsync(250)
      await promise

      // Same post-settle invariants the legacy chatTurn.test.ts asserts:
      // isLoading is false and no streaming placeholder remains. The
      // assistant text itself comes from streaming token events, which
      // this happy-path test does not drive.
      expect(useChat.getState().isLoading).toBe(false)
      expect(useChat.getState().assistantPlaceholderId).toBeNull()
      // The user message landed on the mirrored timeline.
      const messagesAfter = useChat.getState().messages
      expect(messagesAfter.find((m) => m.role === 'user')?.content).toBe(
        'hello world'
      )
    })

    it('cancel() forwards to window.api.aiCancelGeneration with the active sessionId', async () => {
      useSessionsStore.setState({ currentSessionId: 'sess-y' })
      await useChat.getState().cancel()
      expect(api.aiCancelGeneration).toHaveBeenCalledWith('sess-y')
    })

    it('newSession() resets the slice via the legacy stores', () => {
      useSessionsStore.setState({
        sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
        currentSessionId: 's1',
      })
      useChatTimelineStore.setState({
        ...emptyTimeline,
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      })

      useChat.getState().newSession()

      expect(useChat.getState().currentSessionId).toBeNull()
      expect(useChat.getState().messages).toEqual([])
    })

    it('clearForProjectSwitch() wipes the chat-related slice state', () => {
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
        toastDismissed: null,
        isCompressing: false,
      })

      useChat.getState().clearForProjectSwitch()

      expect(useChat.getState().sessions).toEqual([])
      expect(useChat.getState().currentSessionId).toBeNull()
      expect(useChat.getState().messages).toEqual([])
      expect(useChat.getState().compressedMessages).toBeNull()
    })
  })
})
