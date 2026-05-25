// Fire-and-forget renderer wrapper around the main-process interaction ring.
// Never awaits. Never throws. A logging hiccup must not break a UI action.

export function logInteraction(kind: string, target?: string): void {
  try {
    void window.api.interactions.log(kind, target).catch(() => { /* swallow */ })
  } catch {
    /* swallow — preload not yet wired, etc. */
  }
}
