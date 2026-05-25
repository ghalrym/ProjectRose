// Shape of one entry in the in-memory user-interaction ring.
// `kind` is dot-namespaced (e.g. 'view.changed', 'settings.changed', 'email.opened').
// `target` is an optional non-sensitive identifier — view name, settings key,
// or extension id. NEVER a value, content, name, password, or token.
export interface InteractionLogEntry {
  timestamp: number
  kind: string
  target?: string
}

export const INTERACTION_LOG_CAPACITY = 50
