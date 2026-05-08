// Coarse token estimate. The chars/4 heuristic is good enough for
// "are we near the context limit" decisions; swap to tiktoken without
// changing the call sites if precision becomes important.

interface CountableMessage {
  role: string
  content: string
}

export function estimateTokens(messages: ReadonlyArray<CountableMessage>): number {
  let chars = 0
  for (const m of messages) {
    chars += (m.role?.length ?? 0) + (m.content?.length ?? 0) + 4
  }
  return Math.ceil(chars / 4)
}
