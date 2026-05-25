import { INTERACTION_LOG_CAPACITY, type InteractionLogEntry } from '../../shared/interactionLog'

// In-memory ring of the user's recent UI actions. Capped at
// INTERACTION_LOG_CAPACITY entries; never persisted to disk; reset on app
// restart. Designed to be fire-and-forget: every call site assumes this
// never throws and never blocks.

let ring: InteractionLogEntry[] = []

export function logInteraction(kind: string, target?: string): void {
  if (!kind) return
  const entry: InteractionLogEntry = target === undefined
    ? { timestamp: Date.now(), kind }
    : { timestamp: Date.now(), kind, target }
  ring.push(entry)
  if (ring.length > INTERACTION_LOG_CAPACITY) {
    ring.splice(0, ring.length - INTERACTION_LOG_CAPACITY)
  }
}

// Returns entries newest-last (transcript order) so the agent can read it like
// a timeline. When `limit` is provided, returns only the last `limit` entries.
export function readRecentInteractions(limit?: number): InteractionLogEntry[] {
  if (limit === undefined || limit >= ring.length) return [...ring]
  if (limit <= 0) return []
  return ring.slice(ring.length - limit)
}

// For tests only.
export function clearInteractionLog(): void {
  ring = []
}
