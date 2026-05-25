import { useEffect, useRef, useState } from 'react'
import { useChat } from '../../stores/useChat'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useStatusStore } from '../../stores/useStatusStore'
import type { AssistantMessage, ChatMessage } from '../../types/chatMessages'
import styles from './TtsAutoPlayer.module.css'

// Returns the most recent assistant message that has finished streaming and
// has content worth speaking. Skips error messages and empty messages so a
// failed turn doesn't trigger TTS.
function pickSpeakableMessage(messages: ChatMessage[]): AssistantMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const a = m as AssistantMessage
    if (a.streaming) return null
    if (a.isError) return null
    if (!a.content || a.content.trim().length === 0) return null
    return a
  }
  return null
}

let jobCounter = 0
function nextJobId(): string {
  return `tts-${Date.now()}-${++jobCounter}`
}

export function TtsAutoPlayer(): JSX.Element | null {
  // We hold the audio element in a ref so we can pause/stop it without
  // re-rendering on every playback transition.
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const currentJobIdRef = useRef<string | null>(null)
  // Tracks the message we last *began* speaking (whether or not playback
  // finished). Prevents the same message from re-firing on every store update.
  const lastSpokenIdRef = useRef<string | null>(null)
  // Snapshot of `isLoading` from the previous render so we can detect the
  // true→false edge that marks the end of a turn.
  const prevIsLoadingRef = useRef<boolean>(false)

  const enabled = useSettingsStore((s) => s.tts.enabled)
  const voice = useSettingsStore((s) => s.tts.voice)
  const speed = useSettingsStore((s) => s.tts.speed)
  const messages = useChat((s) => s.messages)
  const isLoading = useChat((s) => s.isLoading)
  const currentSessionId = useChat((s) => s.currentSessionId)

  const [isPlaying, setIsPlaying] = useState(false)

  function stopPlayback(): void {
    const a = audioRef.current
    if (a) {
      try { a.pause() } catch { /* ignore */ }
      a.removeAttribute('src')
      try { a.load() } catch { /* ignore */ }
    }
    if (currentUrlRef.current) {
      try { URL.revokeObjectURL(currentUrlRef.current) } catch { /* ignore */ }
      currentUrlRef.current = null
    }
    if (currentJobIdRef.current) {
      const jobId = currentJobIdRef.current
      window.api.tts.cancel(jobId).catch(() => { /* ignore */ })
      currentJobIdRef.current = null
    }
    setIsPlaying(false)
  }

  // Reset bookkeeping when the session changes. Without this, switching to a
  // saved chat would speak the most recent assistant message because the
  // last-spoken-id was tied to the old session.
  useEffect(() => {
    stopPlayback()
    // Seed lastSpokenIdRef to the current tail so nothing fires immediately.
    const tail = pickSpeakableMessage(useChat.getState().messages)
    lastSpokenIdRef.current = tail?.id ?? null
    prevIsLoadingRef.current = useChat.getState().isLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId])

  // When the master toggle flips off, cut any current playback and clear the
  // queued synthesis so the next "on" doesn't pick up where we left off.
  useEffect(() => {
    if (!enabled) {
      stopPlayback()
      window.api.tts.cancelAll().catch(() => { /* ignore */ })
    }
  }, [enabled])

  // When the user sends a new message, isLoading goes true; we kill any
  // playback so the agent doesn't keep speaking the previous turn over the
  // new one.
  useEffect(() => {
    if (isLoading && (currentJobIdRef.current || isPlaying)) {
      stopPlayback()
    }
  }, [isLoading, isPlaying])

  // The actual auto-play trigger: on every message store update, look for the
  // most recent "finished" assistant message and speak it if it's new.
  useEffect(() => {
    if (!enabled) {
      prevIsLoadingRef.current = isLoading
      return
    }
    const justFinishedTurn = prevIsLoadingRef.current && !isLoading
    prevIsLoadingRef.current = isLoading

    const candidate = pickSpeakableMessage(messages)
    if (!candidate) return
    if (candidate.id === lastSpokenIdRef.current) return
    // Only fire on the loading-false edge. Without this, the message would
    // re-trigger every time the user clicked around (e.g. expanded thinking).
    if (!justFinishedTurn) return

    lastSpokenIdRef.current = candidate.id
    const jobId = nextJobId()
    currentJobIdRef.current = jobId

    void (async () => {
      try {
        const res = await window.api.tts.synthesize({
          jobId,
          text: candidate.content,
          voiceId: voice,
          speed
        })
        // A concurrent stopPlayback() may have superseded this job between
        // request and response — drop the result if so.
        if (currentJobIdRef.current !== jobId) return
        if (!res.wav || res.wav.byteLength === 0) {
          currentJobIdRef.current = null
          return
        }
        const blob = new Blob([res.wav], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        currentUrlRef.current = url
        if (!audioRef.current) audioRef.current = new Audio()
        const audio = audioRef.current
        audio.src = url
        audio.onended = () => {
          if (currentUrlRef.current === url) {
            URL.revokeObjectURL(url)
            currentUrlRef.current = null
          }
          if (currentJobIdRef.current === jobId) currentJobIdRef.current = null
          setIsPlaying(false)
        }
        audio.onerror = () => {
          setIsPlaying(false)
          currentJobIdRef.current = null
        }
        setIsPlaying(true)
        await audio.play().catch(() => {
          // Autoplay blocked or audio device missing — surface silently and
          // reset state. Future invocations can still try.
          setIsPlaying(false)
        })
      } catch (err) {
        if (currentJobIdRef.current === jobId) currentJobIdRef.current = null
        const msg = err instanceof Error ? err.message : String(err)
        // Don't notify on plain AbortErrors — those are expected (user sent
        // a new message, toggled off, etc.).
        if (!/abort/i.test(msg)) {
          useStatusStore.getState().notify(`TTS failed: ${msg}`, { tone: 'error' })
        }
      }
    })()
  }, [enabled, messages, isLoading, voice, speed])

  // Component unmount cleanup: also kill the audio element entirely so it
  // can't outlive React.
  useEffect(() => {
    return () => {
      stopPlayback()
      audioRef.current = null
    }
  }, [])

  if (!isPlaying) return null
  return (
    <button
      type="button"
      className={styles.stopPill}
      onClick={stopPlayback}
      title="Stop speaking"
    >
      <span className={styles.stopPillDot} />
      STOP SPEAKING
    </button>
  )
}
