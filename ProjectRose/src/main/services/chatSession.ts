/**
 * A `ChatSession` owns all state whose lifetime equals a single chat turn:
 * the abort controller, the pending ask-user table, the pending screenshot
 * table, the per-turn `modifiedFiles` list, and the per-turn extension hook
 * budgets. Construct one at the start of a turn, dispose it in `finally`.
 *
 * Slices move each piece onto the session one at a time; today the
 * `pendingAskUser` table lives here, while `pendingScreenshots`,
 * `modifiedFiles`, and `turnBudget` remain at module scope and will follow.
 */
export class ChatSession {
  readonly sessionId: string
  readonly rootPath: string
  readonly abortController: AbortController

  // Pending ask_user resolvers — keyed by toolCallId. The `ask_user` tool
  // pushes a resolver here when it emits the question to the renderer; the
  // renderer's reply is routed back here via the IPC handler.
  readonly pendingAskUser = new Map<string, (answer: string) => void>()

  constructor(args: { sessionId: string; rootPath: string }) {
    this.sessionId = args.sessionId
    this.rootPath = args.rootPath
    this.abortController = new AbortController()
  }

  get abortSignal(): AbortSignal {
    return this.abortController.signal
  }

  /**
   * Look up a pending ask-user resolver and fulfil it. No-op if the id is
   * not pending (the question was already answered or cancelled).
   */
  resolveAskUserQuestion(toolCallId: string, answer: string): void {
    const resolve = this.pendingAskUser.get(toolCallId)
    if (!resolve) return
    this.pendingAskUser.delete(toolCallId)
    resolve(answer)
  }

  /**
   * Resolve every pending ask-user with `'[cancelled]'`. Called when the
   * user cancels the chat — the renderer no longer expects an answer, so
   * unblocking the tool with a sentinel value lets the turn unwind cleanly.
   */
  cancelPendingAskUser(): void {
    for (const resolve of this.pendingAskUser.values()) resolve('[cancelled]')
    this.pendingAskUser.clear()
  }

  /**
   * Cancel the turn: abort the controller and reject any pending
   * cross-process resolvers owned by this session.
   */
  cancel(): void {
    this.abortController.abort()
    this.cancelPendingAskUser()
  }

  /**
   * Release everything the session held. Called from the `finally` of the
   * turn that constructed it. The registry unregister is the caller's
   * responsibility — `aiService` wires both calls in the same block.
   */
  dispose(): void {
    this.cancelPendingAskUser()
  }
}
