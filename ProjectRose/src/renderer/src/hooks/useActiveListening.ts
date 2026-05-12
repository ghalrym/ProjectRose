import { useEffect } from 'react'
import { useActiveListeningStore } from '../stores/useActiveListeningStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useChatUIStore } from '../stores/useChatUIStore'
import { sendMessage } from '../services/chatTurn'
import { useAudioStream } from './useAudioStream'

/**
 * Lifecycle hook that opens a speech session when active listening is
 * toggled on, wires its utterance and draft events to the store, and
 * fires `sendMessage` when the session reports an auto-submit.
 *
 * All draft-assembly state (wake word, countdown, accumulated text) is
 * owned by the main-side SpeechSession + DraftAssembler. The renderer
 * holds only what the UI renders.
 */
export function useActiveListening(): void {
  const isActive = useActiveListeningStore((s) => s.isActive)
  const sessionId = useActiveListeningStore((s) => s.sessionId)
  const rootPath = useProjectStore((s) => s.rootPath)

  useAudioStream({ enabled: isActive, sessionId, projectPath: rootPath })

  useEffect(() => {
    if (!isActive || !rootPath) return

    const store = useActiveListeningStore.getState()
    let mounted = true
    let capturedSessionId: number | null = null
    let utteranceCleanup: (() => void) | null = null
    let draftCleanup: (() => void) | null = null

    ;(async () => {
      try {
        const { sessionId: id } = await window.api.activeSpeech.openSession({ projectPath: rootPath })
        if (!mounted) return
        capturedSessionId = id
        store.setSessionId(id)
        store.setViewingSession(id)
        store.setUtterances([])

        const speakers = await window.api.activeSpeech.getSpeakers(rootPath)
        if (mounted) store.setSpeakers(speakers)

        utteranceCleanup = window.api.activeSpeech.onUtterance((evt) => {
          if (!mounted || evt.sessionId !== id) return

          // Suppress UI updates while user is browsing an archive; main still persists to DB.
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
          if (evt.status === 'building') {
            draftStore.setDraft(evt.text, evt.secondsLeft)
          } else if (evt.status === 'submitted') {
            useChatUIStore.getState().setInputValue(evt.text)
            sendMessage()
            draftStore.clearDraft()
          } else {
            draftStore.clearDraft()
          }
        })
      } catch {
        // session open failed silently
      }
    })()

    return () => {
      mounted = false
      utteranceCleanup?.()
      draftCleanup?.()
      const sid = capturedSessionId
      if (sid !== null) {
        window.api.activeSpeech.closeSession({ sessionId: sid, projectPath: rootPath }).catch(() => {})
      }
      useActiveListeningStore.getState().setSessionId(null)
      useActiveListeningStore.getState().clearDraft()
    }
  }, [isActive, rootPath])
}
