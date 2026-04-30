import { useState, useRef, useEffect } from 'react'
import { useActiveListeningStore } from '../../stores/useActiveListeningStore'
import type { Utterance, Speaker } from '../../stores/useActiveListeningStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import styles from './TranscriptView.module.css'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// SQLite datetime('now') is UTC without a tz suffix; append 'Z' so JS treats it as UTC.
function parseDbTime(s: string): number {
  return new Date(s.replace(' ', 'T') + 'Z').getTime()
}

function formatSessionLabel(s: { id: number; started_at: string; ended_at: string | null }): string {
  const ts = parseDbTime(s.started_at)
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const date = sameDay ? 'today' : d.toISOString().slice(0, 10)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `#${String(s.id).padStart(3, '0')} · ${date} ${time}`
}

function speakerColor(name: string | null): string {
  if (!name) return 'var(--color-text-muted)'
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 40%, 32%)`
}

function SpeakerChip({ utterance, displayName, speakers, onLabel }: {
  utterance: Utterance
  displayName: string
  speakers: Speaker[]
  onLabel: (utteranceId: number, speakerId: number | null, speakerName: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (!dropRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = displayName
  const color = speakerColor(utterance.speakerId !== null ? displayName : null)

  const handleSelect = (speaker: Speaker): void => {
    onLabel(utterance.utteranceId, speaker.id, speaker.name)
    setOpen(false)
  }

  const handleNewSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    onLabel(utterance.utteranceId, null, name)
    setNewName('')
    setShowNew(false)
    setOpen(false)
  }

  return (
    <div className={styles.chipWrap} ref={dropRef}>
      <button
        className={styles.chip}
        style={{ background: color }}
        onClick={() => setOpen((v) => !v)}
        title="Click to label speaker"
      >
        {label} ▾
      </button>
      {open && (
        <div className={styles.dropdown}>
          {speakers.map((s) => (
            <button key={s.id} className={styles.dropItem} onClick={() => handleSelect(s)}>
              {s.name}
            </button>
          ))}
          {!showNew ? (
            <button className={styles.dropItem} onClick={() => setShowNew(true)}>
              + New person
            </button>
          ) : (
            <form className={styles.newNameForm} onSubmit={handleNewSubmit}>
              <input
                className={styles.newNameInput}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name..."
                autoFocus
              />
              <button type="submit" className={styles.newNameBtn}>Add</button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

function resolveDisplayName(
  utterance: Utterance,
  enrolledSpeakerId: number | null,
  userName: string
): string {
  if (!userName) return utterance.speakerName ?? 'Unknown'

  // Match by enrolled speaker ID (primary — works after enrollment)
  if (utterance.speakerId !== null && enrolledSpeakerId !== null &&
      Number(utterance.speakerId) === Number(enrolledSpeakerId)) {
    return userName
  }

  // Fallback: "User" is the default name written to the DB during enrollment
  // when userName wasn't set yet. Substitute the real name if we have it.
  if (utterance.speakerName?.toLowerCase() === 'user') {
    return userName
  }

  return utterance.speakerName ?? 'Unknown'
}

type SessionRow = { id: number; project_id: string | null; started_at: string; ended_at: string | null; utterance_count: number }

export function TranscriptView(): JSX.Element {
  const utterances = useActiveListeningStore((s) => s.utterances)
  const speakers = useActiveListeningStore((s) => s.speakers)
  const sessionId = useActiveListeningStore((s) => s.sessionId)
  const viewingSessionId = useActiveListeningStore((s) => s.viewingSessionId)
  const isActive = useActiveListeningStore((s) => s.isActive)
  const isDrafting = useActiveListeningStore((s) => s.isDrafting)
  const draftSecondsLeft = useActiveListeningStore((s) => s.draftSecondsLeft)
  const rootPath = useProjectStore((s) => s.rootPath)
  const userName = useSettingsStore((s) => s.userName)
  const roseSpeechSpeakerId = useSettingsStore((s) => s.roseSpeechSpeakerId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const [retraining, setRetraining] = useState(false)
  const [trainResult, setTrainResult] = useState<string | null>(null)
  const [pastSessions, setPastSessions] = useState<SessionRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [loadingPast, setLoadingPast] = useState(false)

  const isViewingLive = viewingSessionId !== null && viewingSessionId === sessionId

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [utterances.length, isDrafting])

  const refreshPastSessions = async (): Promise<void> => {
    if (!rootPath) return
    try {
      const all = await window.api.activeSpeech.getSessions(rootPath)
      setPastSessions(all)
    } catch {
      // silent
    }
  }

  useEffect(() => {
    refreshPastSessions()
  }, [rootPath, isActive])

  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent): void => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  const loadPastSession = async (id: number): Promise<void> => {
    if (!rootPath) return
    setPickerOpen(false)
    setLoadingPast(true)
    try {
      const [rows, allSpeakers] = await Promise.all([
        window.api.activeSpeech.getUtterances({ sessionId: id, projectPath: rootPath }),
        window.api.activeSpeech.getSpeakers(rootPath)
      ])
      const mapped: Utterance[] = rows.map((r) => ({
        utteranceId: r.id,
        speakerId: r.speaker_id,
        speakerName: r.speaker_name,
        text: r.text,
        timestamp: parseDbTime(r.created_at)
      }))
      const store = useActiveListeningStore.getState()
      store.setSpeakers(allSpeakers)
      store.setUtterances(mapped)
      store.setViewingSession(id)
    } finally {
      setLoadingPast(false)
    }
  }

  const switchToLive = (): void => {
    setPickerOpen(false)
    if (sessionId === null) {
      const store = useActiveListeningStore.getState()
      store.setUtterances([])
      store.setViewingSession(null)
      return
    }
    // Reload from DB to catch utterances suppressed while user was viewing the archive.
    loadPastSession(sessionId)
  }

  const handleLabel = async (utteranceId: number, speakerId: number | null, speakerName: string): Promise<void> => {
    if (!rootPath) return
    try {
      const result = await window.api.activeSpeech.labelSpeaker({
        utteranceId,
        speakerId: speakerId ?? undefined,
        speakerName: speakerId === null ? speakerName : undefined,
        projectPath: rootPath
      })
      useActiveListeningStore.getState().updateUtteranceSpeaker(utteranceId, speakerName)
      if (speakerId === null) {
        useActiveListeningStore.getState().addSpeaker({ id: result.speaker_id, name: speakerName })
      }
    } catch {
      // label failed silently
    }
  }

  const handleRetrain = async (): Promise<void> => {
    if (!rootPath || retraining) return
    setRetraining(true)
    setTrainResult(null)
    try {
      const { job_id } = await window.api.activeSpeech.train(rootPath)
      const poll = setInterval(async () => {
        const status = await window.api.activeSpeech.trainStatus({ jobId: job_id, projectPath: rootPath })
        if (status.status === 'complete' || status.status === 'failed') {
          clearInterval(poll)
          setRetraining(false)
          setTrainResult(
            status.status === 'complete' && status.accuracy !== null
              ? `${Math.round(status.accuracy * 100)}% accuracy`
              : 'Training failed'
          )
        }
      }, 2000)
    } catch {
      setRetraining(false)
      setTrainResult('Error')
    }
  }

  const hasLabeledUtterances = utterances.some((u) => u.speakerName !== null)

  const currentLabel =
    viewingSessionId !== null
      ? (() => {
          const match = pastSessions.find((s) => s.id === viewingSessionId)
          if (match) return formatSessionLabel(match)
          return `#${String(viewingSessionId).padStart(3, '0')}`
        })()
      : '—'

  return (
    <div className={styles.transcript}>
      <div className={styles.header}>
        <div className={styles.sessionPicker} ref={pickerRef}>
          <button
            className={styles.sessionPickerBtn}
            onClick={() => setPickerOpen((v) => !v)}
            type="button"
          >
            <span className={styles.headerLabel}>SESSION</span>
            <span className={styles.sessionPickerCurrent}>{currentLabel}</span>
            {isViewingLive && <span className={styles.liveTag}>LIVE</span>}
            {!isViewingLive && viewingSessionId !== null && <span className={styles.archiveTag}>ARCHIVE</span>}
            <span className={styles.caret}>▾</span>
          </button>
          {pickerOpen && (
            <div className={styles.sessionDropdown}>
              {sessionId !== null && (
                <button
                  className={styles.sessionDropItem}
                  onClick={switchToLive}
                  type="button"
                >
                  <span className={styles.liveDotSm} />
                  LIVE · #{String(sessionId).padStart(3, '0')}
                </button>
              )}
              {(() => {
                const visiblePast = pastSessions.filter(
                  (s) => s.id !== sessionId && s.utterance_count > 0
                )
                if (visiblePast.length === 0 && sessionId === null) {
                  return <div className={styles.sessionDropEmpty}>No previous sessions</div>
                }
                return visiblePast.map((s) => (
                  <button
                    key={s.id}
                    className={styles.sessionDropItem}
                    onClick={() => loadPastSession(s.id)}
                    type="button"
                  >
                    {formatSessionLabel(s)}
                    <span className={styles.utteranceCount}>{s.utterance_count}</span>
                  </button>
                ))
              })()}
            </div>
          )}
        </div>
        <div className={styles.retrainArea}>
          {trainResult && <span className={styles.trainResult}>{trainResult}</span>}
          <button
            className={styles.retrainBtn}
            onClick={handleRetrain}
            disabled={retraining || !hasLabeledUtterances}
            title={hasLabeledUtterances ? 'Retrain voice model with labeled data' : 'Label some speakers first'}
          >
            {retraining ? 'Training…' : '↺ Retrain'}
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {loadingPast && <div className={styles.empty}>Loading…</div>}
        {!loadingPast && utterances.length === 0 && (
          <div className={styles.empty}>
            {viewingSessionId === null
              ? 'No session selected. Start active listening or pick a past session.'
              : isViewingLive
              ? 'No utterances yet. Start speaking.'
              : 'This session has no utterances.'}
          </div>
        )}
        {utterances.map((u) => (
          <div key={u.utteranceId} className={styles.row}>
            <SpeakerChip
              utterance={u}
              displayName={resolveDisplayName(u, roseSpeechSpeakerId, userName)}
              speakers={speakers}
              onLabel={handleLabel}
            />
            <span className={styles.text}>{u.text}</span>
            <span className={styles.time}>{formatTime(u.timestamp)}</span>
          </div>
        ))}
        {isDrafting && isViewingLive && (
          <div className={styles.draftingChip}>
            <span className={styles.draftDot} />
            DRAFTING · auto-send in {draftSecondsLeft ?? 0}s
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
