import { cancelAllAskUserQuestions } from './llmClient'

/**
 * A `ChatSession` owns all state whose lifetime equals a single chat turn:
 * the abort controller, the pending ask-user table, the pending screenshot
 * table, the per-turn `modifiedFiles` list, and the per-turn extension hook
 * budgets. Construct one at the start of a turn, dispose it in `finally`.
 *
 * Today this slice introduces the seam only: the controller folds in here,
 * but the other module-level state stays where it is. Subsequent slices move
 * each piece onto the session one at a time.
 */
export class ChatSession {
  readonly sessionId: string
  readonly rootPath: string
  readonly abortController: AbortController

  constructor(args: { sessionId: string; rootPath: string }) {
    this.sessionId = args.sessionId
    this.rootPath = args.rootPath
    this.abortController = new AbortController()
  }

  get abortSignal(): AbortSignal {
    return this.abortController.signal
  }

  /**
   * Cancel the turn: abort the controller and reject any pending
   * cross-process resolvers. Today the ask-user table still lives in
   * `llmClient.ts` at module scope, so we delegate to its cancel function.
   * Subsequent slices move that table onto the session and this method
   * resolves it directly.
   */
  cancel(): void {
    this.abortController.abort()
    cancelAllAskUserQuestions()
  }

  /**
   * Release everything the session held. Called from the `finally` of the
   * turn that constructed it. The registry unregister is the caller's
   * responsibility — `aiService` wires both calls in the same block.
   */
  dispose(): void {
    // No-op for now. Future slices add `pendingScreenshots` cleanup, etc.
  }
}
