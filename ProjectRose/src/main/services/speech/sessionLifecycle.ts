import * as speechDB from './speechDB'
import { SpeechSession } from './session'
import { SpeechSessionRegistry } from './sessionRegistry'

/**
 * Open a new speech session: create the DB row, instantiate a SpeechSession,
 * add it to the registry, and return its id. The session is immediately
 * accepting chunks — there is no separate "start stream" step.
 *
 * Exported for the IPC handler smoke test.
 */
export function openSpeechSession(
  registry: SpeechSessionRegistry,
  payload: { projectPath: string; projectId?: string },
  deps: {
    createSession?: (projectPath: string, projectId: string | null) => { id: number }
    makeSession?: (sessionId: number, projectPath: string) => SpeechSession
  } = {}
): { sessionId: number } {
  const createSession = deps.createSession ?? speechDB.createSession
  const makeSession = deps.makeSession ?? ((sessionId, projectPath) =>
    new SpeechSession({ sessionId, projectPath }))

  const { id } = createSession(payload.projectPath, payload.projectId ?? null)
  registry.add(makeSession(id, payload.projectPath))
  return { sessionId: id }
}

/**
 * Forward a chunk to its session. Unknown session ids are dropped silently —
 * a late chunk arriving after close() is benign.
 */
export function sendSpeechChunk(
  registry: SpeechSessionRegistry,
  payload: { sessionId: number; audioBuffer: ArrayBuffer }
): void {
  const session = registry.get(payload.sessionId)
  if (!session) return
  session.acceptChunk(payload.audioBuffer).catch(
    (e) => console.error('[Speech] chunk error:', e)
  )
}

/**
 * Close a session: flush in-flight chunks, write the DB ended_at, remove
 * from registry. Idempotent — closing a never-opened or already-closed id
 * just writes ended_at.
 */
export async function closeSpeechSession(
  registry: SpeechSessionRegistry,
  payload: { sessionId: number; projectPath: string },
  deps: { endSession?: (projectPath: string, sessionId: number) => { ok: boolean } } = {}
): Promise<{ ok: boolean }> {
  const endSession = deps.endSession ?? speechDB.endSession
  const session = registry.get(payload.sessionId)
  if (session) {
    await session.close()
    registry.remove(payload.sessionId)
  }
  return endSession(payload.projectPath, payload.sessionId)
}
