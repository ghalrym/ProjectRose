import { useEffect } from 'react'
import { useActiveListeningStore } from '../stores/useActiveListeningStore'
import { useChatUIStore } from '../stores/useChatUIStore'
import { sendMessage } from '../services/chatTurn'

/**
 * Lifecycle effect for the active-listening session: open on enable,
 * subscribe to utterance + draft events, close on disable. Pure
 * side-effects — the visible render state is in useActiveListeningStore.
 *
 * Split out from useActiveListen so the public hook stays a thin selector
 * over the store.
 */
export function useActiveListenSession({ enabled, projectPath }: {
  enabled: boolean
  projectPath: string | null
}): void {
  useEffect(() => {
    if (!enabled || !projectPath) return

    const store = useActiveListeningStore.getState()
    let mounted = true
    let capturedSessionId: number | null = null
    let utteranceCleanup: (() => void) | null = null
    let draftCleanup: (() => void) | null = null

    ;(async () => {
      try {
        const { sessionId: id } = await window.api.activeSpeech.openSession({ projectPath })
        if (!mounted) return
        capturedSessionId = id
        store.setSessionId(id)
        store.setViewingSession(id)
        store.setUtterances([])

        const fetchedSpeakers = await window.api.activeSpeech.getSpeakers(projectPath)
        if (mounted) store.setSpeakers(fetchedSpeakers)

        utteranceCleanup = window.api.activeSpeech.onUtterance((evt) => {
          if (!mounted || evt.sessionId !== id) return
          const viewingId = useActiveListeningStore.getState().viewingSessionId
          if (viewingId !== null && viewingId !== id) return
          const evtSpeakerId = (evt as { speaker_id?: number | null }).speaker_id ?? null
          store.addUtterance({
            utteranceId: evt.utterance_id,
            speakerId: evtSpeakerId,
            speakerName: evt.speaker_name,
            text: evt.text,
            timestamp: Date.now()
          })
        })

        draftCleanup = window.api.activeSpeech.onDraft((evt) => {
          if (!mounted || evt.sessionId !== id) return
          const draftStore = useActiveListeningStore.getState()
          if (evt.status === 'building') draftStore.setDraft(evt.text, evt.secondsLeft)
          else if (evt.status === 'submitted') {
            useChatUIStore.getState().setInputValue(evt.text)
            sendMessage()
            draftStore.clearDraft()
          } else draftStore.clearDraft()
        })
      } catch { /* session open failed silently */ }
    })()

    return () => {
      mounted = false
      utteranceCleanup?.()
      draftCleanup?.()
      const sid = capturedSessionId
      if (sid !== null) {
        window.api.activeSpeech.closeSession({ sessionId: sid, projectPath }).catch(() => {})
      }
      useActiveListeningStore.getState().setSessionId(null)
      useActiveListeningStore.getState().clearDraft()
    }
  }, [enabled, projectPath])
}
