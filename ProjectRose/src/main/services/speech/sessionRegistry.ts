import { SpeechSession } from './session'

/**
 * The IPC layer's single source of truth for live SpeechSessions, keyed by
 * the DB session id. Owning sessions here (rather than in module scope inside
 * the service) means lifecycle is explicit: add on open, remove on close.
 */
export class SpeechSessionRegistry {
  private sessions = new Map<number, SpeechSession>()

  add(session: SpeechSession): void {
    this.sessions.set(session.sessionId, session)
  }

  get(sessionId: number): SpeechSession | undefined {
    return this.sessions.get(sessionId)
  }

  remove(sessionId: number): void {
    this.sessions.delete(sessionId)
  }

  size(): number {
    return this.sessions.size
  }
}
