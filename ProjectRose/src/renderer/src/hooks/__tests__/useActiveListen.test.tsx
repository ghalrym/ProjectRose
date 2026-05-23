// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useActiveListen } from '../useActiveListen'
import { useActiveListeningStore } from '../../stores/useActiveListeningStore'

// Mock the chat slice so the hook's `defaultSendDraft` can call send()
// without pulling in the entire chat pipeline.
const sendMessageMock = vi.fn()
vi.mock('../../stores/useChat', async () => {
  const actual = await vi.importActual<typeof import('../../stores/useChat')>(
    '../../stores/useChat'
  )
  return {
    ...actual,
    useChat: Object.assign(
      (selector: (s: ReturnType<typeof actual.useChat.getState>) => unknown) =>
        actual.useChat(selector),
      {
        getState: () => ({
          ...actual.useChat.getState(),
          send: sendMessageMock,
        }),
      }
    ),
  }
})

// Mock useAudioStream — we don't want a real MediaRecorder here.
vi.mock('../useAudioStream', () => ({
  useAudioStream: () => {}
}))

type UtteranceListener = (evt: { sessionId: number; utterance_id: number; speaker_name: string | null; text: string; speaker_id: number | null }) => void
type DraftListener = (evt: { sessionId: number; status: 'building' | 'submitted' | 'cancelled'; text: string; secondsLeft: number | null }) => void

interface FakeApi {
  prepareSession: ReturnType<typeof vi.fn>
  openSession: ReturnType<typeof vi.fn>
  closeSession: ReturnType<typeof vi.fn>
  getSpeakers: ReturnType<typeof vi.fn>
  onUtterance: ReturnType<typeof vi.fn>
  onDraft: ReturnType<typeof vi.fn>
  sendChunk: ReturnType<typeof vi.fn>
  cancelDraft: ReturnType<typeof vi.fn>
  utteranceListeners: UtteranceListener[]
  draftListeners: DraftListener[]
}

function installFakeApi(sessionId: number): FakeApi {
  const utteranceListeners: UtteranceListener[] = []
  const draftListeners: DraftListener[] = []
  const api: FakeApi = {
    prepareSession: vi.fn(async () => ({ ok: true })),
    openSession: vi.fn(async () => ({ sessionId })),
    closeSession: vi.fn(async () => ({ ok: true })),
    getSpeakers: vi.fn(async () => []),
    onUtterance: vi.fn((cb: UtteranceListener) => {
      utteranceListeners.push(cb)
      return () => { utteranceListeners.splice(utteranceListeners.indexOf(cb), 1) }
    }),
    onDraft: vi.fn((cb: DraftListener) => {
      draftListeners.push(cb)
      return () => { draftListeners.splice(draftListeners.indexOf(cb), 1) }
    }),
    sendChunk: vi.fn(),
    cancelDraft: vi.fn(),
    utteranceListeners,
    draftListeners
  }
  ;(window as unknown as { api: { activeSpeech: unknown } }).api = {
    activeSpeech: api
  }
  return api
}

function Probe({ enabled, projectPath }: { enabled: boolean; projectPath: string | null }): React.ReactElement {
  const state = useActiveListen({ enabled, projectPath })
  return (
    <div>
      <span data-testid="text">{state.draftText}</span>
      <span data-testid="seconds">{String(state.draftSecondsLeft)}</span>
      <span data-testid="isDrafting">{String(state.isDrafting)}</span>
      <span data-testid="utteranceCount">{state.utterances.length}</span>
    </div>
  )
}

describe('useActiveListen', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    useActiveListeningStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
  })

  it('opens a session on enable and closes it on disable', async () => {
    const api = installFakeApi(42)

    const { rerender, unmount } = render(<Probe enabled={true} projectPath="/p" />)
    // Wait for the async open() to complete.
    await act(async () => { await Promise.resolve() })

    expect(api.openSession).toHaveBeenCalledWith({ projectPath: '/p' })

    rerender(<Probe enabled={false} projectPath="/p" />)
    await act(async () => { await Promise.resolve() })

    expect(api.closeSession).toHaveBeenCalledWith({ sessionId: 42, projectPath: '/p' })
    unmount()
  })

  it('reflects utterance events from main in the returned state', async () => {
    const api = installFakeApi(7)

    const { getByTestId } = render(<Probe enabled={true} projectPath="/p" />)
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      api.utteranceListeners[0]({
        sessionId: 7,
        utterance_id: 1,
        speaker_id: null,
        speaker_name: null,
        text: 'hello'
      })
    })

    expect(getByTestId('utteranceCount').textContent).toBe('1')
  })

  it('updates draft state on draft:building events', async () => {
    const api = installFakeApi(9)
    const { getByTestId } = render(<Probe enabled={true} projectPath="/p" />)
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      api.draftListeners[0]({ sessionId: 9, status: 'building', text: 'rose hello', secondsLeft: 3 })
    })

    expect(getByTestId('text').textContent).toBe('rose hello')
    expect(getByTestId('seconds').textContent).toBe('3')
    expect(getByTestId('isDrafting').textContent).toBe('true')
  })

  it('calls sendMessage once on draft:submitted and clears the draft', async () => {
    const api = installFakeApi(3)
    const { getByTestId } = render(<Probe enabled={true} projectPath="/p" />)
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      api.draftListeners[0]({ sessionId: 3, status: 'submitted', text: 'rose go', secondsLeft: null })
    })

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(getByTestId('isDrafting').textContent).toBe('false')
    expect(getByTestId('text').textContent).toBe('')
  })

  it('clears draft on draft:cancelled', async () => {
    const api = installFakeApi(11)
    const { getByTestId } = render(<Probe enabled={true} projectPath="/p" />)
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      api.draftListeners[0]({ sessionId: 11, status: 'building', text: 'rose hi', secondsLeft: 3 })
    })
    expect(getByTestId('isDrafting').textContent).toBe('true')

    await act(async () => {
      api.draftListeners[0]({ sessionId: 11, status: 'cancelled', text: '', secondsLeft: null })
    })
    expect(getByTestId('isDrafting').textContent).toBe('false')
    expect(sendMessageMock).not.toHaveBeenCalled()
  })
})
