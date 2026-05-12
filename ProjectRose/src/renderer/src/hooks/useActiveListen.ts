import { useActiveListeningStore, type Speaker, type Utterance } from '../stores/useActiveListeningStore'
import { useActiveListenSession } from './useActiveListenSession'
import { useAudioStream } from './useAudioStream'

export interface ActiveListenState {
  utterances: Utterance[]
  draftText: string
  draftSecondsLeft: number | null
  isDrafting: boolean
  speakers: Speaker[]
}

/**
 * Thin event-wiring hook. When `enabled`, opens a speech session on main,
 * subscribes to its utterance and draft events, and fires sendMessage when
 * the session reports an auto-submit. Returns the live render state.
 *
 * Session lifecycle lives in useActiveListenSession; mic-pump lives in
 * useAudioStream. This hook is just the selector over the store.
 */
export function useActiveListen({ enabled, projectPath }: {
  enabled: boolean
  projectPath: string | null
}): ActiveListenState {
  const sessionId = useActiveListeningStore((s) => s.sessionId)
  useAudioStream({ enabled, sessionId, projectPath })
  useActiveListenSession({ enabled, projectPath })

  return {
    utterances: useActiveListeningStore((s) => s.utterances),
    draftText: useActiveListeningStore((s) => s.draftText),
    draftSecondsLeft: useActiveListeningStore((s) => s.draftSecondsLeft),
    isDrafting: useActiveListeningStore((s) => s.isDrafting),
    speakers: useActiveListeningStore((s) => s.speakers)
  }
}
