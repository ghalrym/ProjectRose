import { create } from 'zustand'

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
}

export const useActiveListeningStore = create<ActiveListeningState>()((set) => ({
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
  setDraft: (text, secondsLeft) => set({ isDrafting: true, draftText: text, draftSecondsLeft: secondsLeft }),
  clearDraft: () => set({ isDrafting: false, draftText: '', draftSecondsLeft: null }),
  reset: () => set({ utterances: [], speakers: [], isDrafting: false, draftText: '', draftSecondsLeft: null, sessionId: null, viewingSessionId: null }),
}))
