import { ChatSession } from './chatSession'

/**
 * Process-level singleton mapping `sessionId -> ChatSession`. IPC handlers
 * that today look up state by a bare id (`questionId`, `requestId`) will
 * shift to looking up the session by `sessionId` and calling methods on it.
 *
 * Today's renderer only runs one chat at a time, so in practice the map
 * holds at most one entry — but everything is already keyed by `sessionId`
 * so the constraint is the renderer's, not the registry's.
 */
class ChatSessionRegistry {
  private sessions = new Map<string, ChatSession>()

  register(session: ChatSession): void {
    this.sessions.set(session.sessionId, session)
  }

  unregister(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  get(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Returns the most recently registered session, if any. Used by the
   * `AI_CANCEL` IPC handler, which the renderer fires without a sessionId
   * because today there is only one active chat at a time.
   */
  getActive(): ChatSession | undefined {
    let latest: ChatSession | undefined
    for (const s of this.sessions.values()) latest = s
    return latest
  }

  size(): number {
    return this.sessions.size
  }
}

export const sessionRegistry = new ChatSessionRegistry()
