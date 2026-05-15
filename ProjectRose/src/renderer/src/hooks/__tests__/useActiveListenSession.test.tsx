// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useActiveListenSession } from '../useActiveListenSession'
import { useActiveListeningStore } from '../../stores/useActiveListeningStore'
import { useChat } from '../../stores/useChat'

const sendMock = vi.fn()
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
          send: sendMock,
        }),
      }
    ),
  }
})

type UtteranceListener = (evt: { sessionId: number; utterance_id: number; speaker_name: string | null; text: string; speaker_id?: number | null }) => void
type DraftListener = (evt: { sessionId: number; status: 'building' | 'submitted' | 'cancelled'; text: string; secondsLeft: number | null }) => void

interface FakeApi {
  openSession: ReturnType<typeof vi.fn>
  closeSession: ReturnType<typeof vi.fn>
  getSpeakers: ReturnType<typeof vi.fn>
  onUtterance: ReturnType<typeof vi.fn>
  onDraft: ReturnType<typeof vi.fn>
  utteranceListeners: UtteranceListener[]
  draftListeners: DraftListener[]
}

function installFakeApi(sessionId: number, openShouldThrow = false): FakeApi {
  const utteranceListeners: UtteranceListener[] = []
  const draftListeners: DraftListener[] = []
  const api: FakeApi = {
    openSession: vi.fn(async () => {
      if (openShouldThrow) throw new Error('boom')
      return { sessionId }
    }),
    closeSession: vi.fn(async () => ({ ok: true })),
    getSpeakers: vi.fn(async () => [{ id: 1, name: 'Alice' }]),
    onUtterance: vi.fn((cb: UtteranceListener) => {
      utteranceListeners.push(cb)
      return (): void => { utteranceListeners.splice(utteranceListeners.indexOf(cb), 1) }
    }),
    onDraft: vi.fn((cb: DraftListener) => {
      draftListeners.push(cb)
      return (): void => { draftListeners.splice(draftListeners.indexOf(cb), 1) }
    }),
    utteranceListeners,
    draftListeners
  }
  ;(window as unknown as { api: { activeSpeech: unknown } }).api = {
    activeSpeech: api
  }
  return api
}

function Probe({ enabled, projectPath }: { enabled: boolean; projectPath: string | null }): React.ReactElement {
  useActiveListenSession({ enabled, projectPath })
  return <div />
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('useActiveListenSession', () => {
  beforeEach(() => {
    sendMock.mockClear()
    useActiveListeningStore.getState().reset?.()
    useChat.getState().setInputValue('')
  })

  afterEach(() => {
    cleanup()
    delete (window as unknown as { api?: unknown }).api
  })

  it('does not open a session when disabled', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={false} projectPath="/p" />)
    await flush()
    expect(api.openSession).not.toHaveBeenCalled()
  })

  it('does not open a session when projectPath is null', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath={null} />)
    await flush()
    expect(api.openSession).not.toHaveBeenCalled()
  })

  it('opens the session and sets sessionId on the store when enabled', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    expect(api.openSession).toHaveBeenCalledWith({ projectPath: '/p' })
    expect(useActiveListeningStore.getState().sessionId).toBe(42)
  })

  it('fetches speakers and stores them after opening', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    expect(api.getSpeakers).toHaveBeenCalledWith('/p')
    expect(useActiveListeningStore.getState().speakers).toEqual([{ id: 1, name: 'Alice' }])
  })

  it('routes matching utterance events into the store', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    await act(async () => {
      api.utteranceListeners[0]({
        sessionId: 42,
        utterance_id: 9,
        speaker_name: 'Bob',
        speaker_id: 7,
        text: 'hello world'
      })
    })
    const utterances = useActiveListeningStore.getState().utterances
    expect(utterances).toHaveLength(1)
    expect(utterances[0]).toMatchObject({ utteranceId: 9, speakerName: 'Bob', text: 'hello world' })
  })

  it('ignores utterance events from a different session', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    await act(async () => {
      api.utteranceListeners[0]({
        sessionId: 999,
        utterance_id: 9,
        speaker_name: 'Bob',
        speaker_id: 7,
        text: 'ghost'
      })
    })
    expect(useActiveListeningStore.getState().utterances).toHaveLength(0)
  })

  it('sets draft state on a building event', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    await act(async () => {
      api.draftListeners[0]({ sessionId: 42, status: 'building', text: 'partial', secondsLeft: 3 })
    })
    const s = useActiveListeningStore.getState()
    expect(s.draftText).toBe('partial')
    expect(s.draftSecondsLeft).toBe(3)
  })

  it('on a submitted draft, populates chat input and calls sendMessage', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    await act(async () => {
      api.draftListeners[0]({ sessionId: 42, status: 'submitted', text: 'go!', secondsLeft: null })
    })
    expect(useChat.getState().inputValue).toBe('go!')
    expect(sendMock).toHaveBeenCalledOnce()
  })

  it('on a cancelled draft, clears draft state and does not send', async () => {
    const api = installFakeApi(42)
    render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    await act(async () => {
      api.draftListeners[0]({ sessionId: 42, status: 'building', text: 'partial', secondsLeft: 2 })
      api.draftListeners[0]({ sessionId: 42, status: 'cancelled', text: '', secondsLeft: null })
    })
    expect(useActiveListeningStore.getState().draftText).toBe('')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('closes the session and clears state on unmount', async () => {
    const api = installFakeApi(42)
    const { unmount } = render(<Probe enabled={true} projectPath="/p" />)
    await flush()
    unmount()
    await flush()
    expect(api.closeSession).toHaveBeenCalledWith({ sessionId: 42, projectPath: '/p' })
    expect(useActiveListeningStore.getState().sessionId).toBeNull()
  })

  it('swallows openSession failures without throwing', async () => {
    installFakeApi(42, true)
    expect(() => render(<Probe enabled={true} projectPath="/p" />)).not.toThrow()
    await flush()
    expect(useActiveListeningStore.getState().sessionId).toBeNull()
  })
})
