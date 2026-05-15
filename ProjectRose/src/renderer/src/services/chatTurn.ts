// Thin shims that forward to the `useChat` slice. PRD `chat-turn-unification`
// (issue #9) moved every orchestration body — model fallback notify, the
// post-resolution defer, the empty-response branch, persistence wiring —
// onto `useChat`. The named exports here remain so:
//   - the legacy `chatTurn.test.ts` suite still drives the same behaviours
//     through these entry points (deleted in issue #10),
//   - `useActiveListeningStore` can keep its `sendMessage` import unchanged.
//
// The slice owns the timer that defers settle for trailing IPC events, so
// `newSession` and `clearChatForProjectSwitch` here go through the slice's
// methods to ensure the timer is cleared. Persistence helpers (`loadSessions`
// etc.) likewise go through the slice's actions.

import { useChat } from '../stores/useChat'

export async function sendMessage(): Promise<void> {
  await useChat.getState().send()
}

export async function cancelGeneration(): Promise<void> {
  await useChat.getState().cancel()
}

export async function answerAskUser(questionId: string, answer: string): Promise<void> {
  await useChat.getState().answerAskUser(questionId, answer)
}

export function newSession(): void {
  useChat.getState().newSession()
}

export async function loadSessions(rootPath: string): Promise<void> {
  // The slice reads rootPath from useProjectStore; the legacy signature
  // accepted it explicitly. We honor the caller's argument by routing
  // through the slice — useChat reads the project store at call time so
  // any caller passing a different rootPath today must set it in the
  // project store first (the only caller, ChatPanel, already does this).
  void rootPath
  await useChat.getState().loadSessions()
}

export async function switchSession(rootPath: string, sessionId: string): Promise<void> {
  void rootPath
  await useChat.getState().switchSession(sessionId)
}

export async function deleteSession(rootPath: string, sessionId: string): Promise<void> {
  void rootPath
  await useChat.getState().deleteSession(sessionId)
}

export async function renameSession(
  rootPath: string,
  sessionId: string,
  title: string
): Promise<void> {
  void rootPath
  await useChat.getState().renameSession(sessionId, title)
}

export function clearChatForProjectSwitch(): void {
  useChat.getState().clearForProjectSwitch()
}
