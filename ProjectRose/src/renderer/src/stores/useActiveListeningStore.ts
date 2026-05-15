import { create } from 'zustand'
import { useChat } from './useChat'

export interface Utterance {
  utteranceId: number
  speakerId: number | null
  speakerName: string | null
  text: string
  timestamp: number
}

export interface Speaker {
  id: number
  name: string
}

export interface InitOpts {
  // Called by the slice when main reports a submitted draft. The renderer
  // supplies this so the slice itself stays React-unaware — it writes
  // chat-input + fires sendMessage through the callback rather than reaching
  // across modules.
  sendDraft: (text: string) => void
}

interface ActiveListeningState {
  isActive: boolean
  sessionId: number | null
  viewingSessionId: number | null
  mode: 'chat' | 'transcript'
  utterances: Utterance[]
  speakers: Speaker[]
  isDrafting: boolean
  draftText: string
  draftSecondsLeft: number | null

  setActive: (v: boolean) => void
  setSessionId: (id: number | null) => void
  setViewingSession: (id: number | null) => void
  setMode: (m: 'chat' | 'transcript') => void
  addUtterance: (u: Utterance) => void
  setUtterances: (us: Utterance[]) => void
  updateUtteranceSpeaker: (utteranceId: number, speakerName: string) => void
  setSpeakers: (s: Speaker[]) => void
  addSpeaker: (s: Speaker) => void
  // Session-event-driven setters: the only way draft state is updated.
  // Hook logic that used to call startDraft / appendDraft / completeDraft
  // / cancelDraft / setDraftSecondsLeft now lives on main inside
  // DraftAssembler, and the renderer just reflects what main emits.
  setDraft: (text: string, secondsLeft: number | null) => void
  clearDraft: () => void
  reset: () => void
  // Open a speech session on main, subscribe to its utterance + draft
  // events, and return a teardown that closes the session and clears
  // session-scoped state. The hook layer just calls this from a
  // useEffect — the IPC, the event routing, and the cleanup all live on
  // the slice. `sendDraft` is the renderer-supplied callback that runs
  // when main reports a submitted draft (typically: write to chat input,
  // call sendMessage).
  init: (projectPath: string, opts: InitOpts) => () => void
}

export const useActiveListeningStore = create<ActiveListeningState>()((set, get) => ({
  isActive: false,
  sessionId: null,
  viewingSessionId: null,
  mode: 'chat',
  utterances: [],
  speakers: [],
  isDrafting: false,
  draftText: '',
  draftSecondsLeft: null,

  setActive: (v) => set({ isActive: v }),
  setSessionId: (id) => set({ sessionId: id }),
  setViewingSession: (id) => set({ viewingSessionId: id }),
  setMode: (m) => set({ mode: m }),
  addUtterance: (u) => set((s) => ({ utterances: [...s.utterances, u] })),
  setUtterances: (us) => set({ utterances: us }),
  updateUtteranceSpeaker: (utteranceId, speakerName) =>
    set((s) => ({
      utterances: s.utterances.map((u) =>
        u.utteranceId === utteranceId ? { ...u, speakerName } : u
      )
    })),
  setSpeakers: (sp) => set({ speakers: sp }),
  addSpeaker: (sp) => set((s) => ({ speakers: [...s.speakers, sp] })),
  setDraft: (text, secondsLeft) =>
    set({ isDrafting: true, draftText: text, draftSecondsLeft: secondsLeft }),
  clearDraft: () => set({ isDrafting: false, draftText: '', draftSecondsLeft: null }),
  reset: () =>
    set({
      utterances: [],
      speakers: [],
      isDrafting: false,
      draftText: '',
      draftSecondsLeft: null,
      sessionId: null,
      viewingSessionId: null
    }),
  init: (projectPath, opts) => {
    let mounted = true
    let capturedSessionId: number | null = null
    let utteranceCleanup: (() => void) | null = null
    let draftCleanup: (() => void) | null = null

    ;(async () => {
      try {
        const { sessionId: id } = await window.api.activeSpeech.openSession({ projectPath })
        if (!mounted) return
        capturedSessionId = id
        set({ sessionId: id, viewingSessionId: id, utterances: [] })

        const fetchedSpeakers = await window.api.activeSpeech.getSpeakers(projectPath)
        if (mounted) set({ speakers: fetchedSpeakers })

        utteranceCleanup = window.api.activeSpeech.onUtterance((evt) => {
          if (!mounted || evt.sessionId !== id) return
          const viewingId = get().viewingSessionId
          if (viewingId !== null && viewingId !== id) return
          const evtSpeakerId = (evt as { speaker_id?: number | null }).speaker_id ?? null
          get().addUtterance({
            utteranceId: evt.utterance_id,
            speakerId: evtSpeakerId,
            speakerName: evt.speaker_name,
            text: evt.text,
            timestamp: Date.now()
          })
        })

        draftCleanup = window.api.activeSpeech.onDraft((evt) => {
          if (!mounted || evt.sessionId !== id) return
          if (evt.status === 'building') get().setDraft(evt.text, evt.secondsLeft)
          else if (evt.status === 'submitted') {
            opts.sendDraft(evt.text)
            get().clearDraft()
          } else get().clearDraft()
        })
      } catch {
        /* session open failed silently */
      }
    })()

    return () => {
      mounted = false
      utteranceCleanup?.()
      draftCleanup?.()
      const sid = capturedSessionId
      if (sid !== null) {
        window.api.activeSpeech.closeSession({ sessionId: sid, projectPath }).catch(() => {})
      }
      set({ sessionId: null })
      get().clearDraft()
    }
  }
}))

// Default sendDraft used by the renderer's edge-wiring hook: write the
// submitted draft into chat input and fire sendMessage. Exported here so the
// hook layer is a one-liner, and so tests can drive `init` without
// duplicating the wiring.
export function defaultSendDraft(text: string): void {
  useChat.getState().setInputValue(text)
  void useChat.getState().send()
}
