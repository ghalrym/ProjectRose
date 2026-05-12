import type { UtteranceEvent } from './session'

export type DraftStatus = 'building' | 'submitted' | 'cancelled'

export interface DraftEvent {
  status: DraftStatus
  text: string
  secondsLeft: number | null
}

export type DraftListener = (evt: DraftEvent) => void

/**
 * Settings the assembler needs. Read fresh on every utterance so changes
 * (agent name, enrolled speaker, draft seconds) take effect on the next
 * utterance without re-mounting the session.
 */
export interface DraftSettings {
  agentName: string
  roseSpeechSpeakerId: number | null
  activeListeningDraftSeconds: number
}

export type DraftSettingsProvider = () => Promise<DraftSettings>

/**
 * Minimal clock surface so tests can drive timers without real time.
 */
export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

const realClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>)
}

export interface DraftAssemblerDeps {
  clock?: Clock
  settings: DraftSettingsProvider
}

/**
 * Owns the wake-word → countdown → auto-submit state machine for a single
 * speech session. Driven by `ingest(utterance)`; emits `draft` events
 * (`building` | `submitted` | `cancelled`) the session forwards onward.
 *
 * Settings are re-read per utterance so the renderer never has to push
 * changes mid-session.
 */
export class DraftAssembler {
  private listeners = new Set<DraftListener>()
  private clock: Clock
  private getSettings: DraftSettingsProvider

  private isDrafting = false
  private draftText = ''
  private secondsLeft: number | null = null

  private timeoutHandle: unknown = null
  private tickHandle: unknown = null

  constructor(deps: DraftAssemblerDeps) {
    this.clock = deps.clock ?? realClock
    this.getSettings = deps.settings
  }

  onDraft(listener: DraftListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Process a fresh utterance from the session. Decides — based on current
   * settings + draft state — whether to start a draft, extend one, or
   * ignore.
   */
  async ingest(utterance: UtteranceEvent): Promise<void> {
    const settings = await this.getSettings()

    // isUser: true when speaker is unidentified (could be anyone) or
    // confirmed to be the enrolled user by ID. Only false when positively
    // identified as someone else.
    const speakerId = utterance.speaker_id
    const isUser = speakerId === null
      || settings.roseSpeechSpeakerId === null
      || speakerId === settings.roseSpeechSpeakerId

    const wakeWord = settings.agentName
    const hasWakeWord = Boolean(wakeWord)
      && utterance.text.toLowerCase().includes(wakeWord.toLowerCase())

    if (!this.isDrafting && isUser && hasWakeWord) {
      this.isDrafting = true
      this.draftText = utterance.text
      this.emit('building')
      this.startTimer(settings.activeListeningDraftSeconds)
      return
    }

    if (this.isDrafting && isUser) {
      this.draftText = this.draftText + ' ' + utterance.text
      this.emit('building')
      this.startTimer(settings.activeListeningDraftSeconds)
    }
  }

  /**
   * Cancel any in-flight draft without submitting. The next utterance will
   * start fresh.
   */
  cancel(): void {
    if (!this.isDrafting) return
    this.clearTimer()
    this.emit('cancelled')
    this.isDrafting = false
    this.draftText = ''
    this.secondsLeft = null
  }

  /**
   * Stop and clear all timers. Used when the parent session closes.
   */
  dispose(): void {
    this.clearTimer()
    this.listeners.clear()
    this.isDrafting = false
    this.draftText = ''
    this.secondsLeft = null
  }

  private startTimer(seconds: number): void {
    this.clearTimer()
    const total = Math.max(1, Math.round(seconds))
    let count = total
    this.secondsLeft = count
    this.emit('building')

    this.tickHandle = this.clock.setInterval(() => {
      count--
      this.secondsLeft = count > 0 ? count : null
      this.emit('building')
    }, 1000)

    this.timeoutHandle = this.clock.setTimeout(() => {
      this.clearTimer()
      this.emit('submitted')
      this.isDrafting = false
      this.draftText = ''
      this.secondsLeft = null
    }, total * 1000)
  }

  private clearTimer(): void {
    if (this.timeoutHandle !== null) {
      this.clock.clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
    if (this.tickHandle !== null) {
      this.clock.clearInterval(this.tickHandle)
      this.tickHandle = null
    }
    this.secondsLeft = null
  }

  private emit(status: DraftStatus): void {
    const evt: DraftEvent = {
      status,
      text: this.draftText,
      secondsLeft: this.secondsLeft
    }
    for (const l of this.listeners) {
      try { l(evt) } catch (e) { console.error('[Speech] draft listener threw:', e) }
    }
  }
}
