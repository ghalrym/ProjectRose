import type { MessageAttachment } from '@shared/roseModelTypes'
import type {
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  AskUserMessage,
  InjectedMessage,
  CompressedApiMessage,
} from '../types/chatMessages'

export type ApiMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: MessageAttachment[]
}

export function settledMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m) => !(m as AssistantMessage).streaming && !(m as ThinkingMessage).streaming
  )
}

// Translates the renderer's ChatMessage timeline into the API-shaped messages
// the main process expects. When `includeThinking` is true, thinking blocks are
// woven into the next assistant message inside <thinking> tags.
export function buildApiMessages(messages: ChatMessage[], includeThinking: boolean): ApiMessage[] {
  const settled = settledMessages(messages)
  if (includeThinking) {
    const apiMessages: ApiMessage[] = []
    let pendingThinking = ''
    for (const m of settled) {
      if (m.role === 'thinking') {
        pendingThinking += (pendingThinking ? '\n\n' : '') + m.content
      } else if (m.role === 'user') {
        pendingThinking = ''
        apiMessages.push({
          role: 'user',
          content: m.content,
          attachments: (m as UserMessage).attachments,
        })
      } else if (m.role === 'assistant') {
        const content = pendingThinking
          ? `<thinking>\n${pendingThinking}\n</thinking>\n\n${m.content}`
          : m.content
        pendingThinking = ''
        apiMessages.push({ role: 'assistant', content })
      } else if (m.role === 'injected') {
        pendingThinking = ''
        apiMessages.push({
          role: 'system',
          content: `[Extension ${(m as InjectedMessage).extensionName}] ${(m as InjectedMessage).content}`,
        })
      }
    }
    return apiMessages
  }
  return settled
    .filter(
      (m): m is UserMessage | AssistantMessage | InjectedMessage =>
        m.role === 'user' || m.role === 'assistant' || m.role === 'injected'
    )
    .map((m): ApiMessage => {
      if (m.role === 'injected') {
        return { role: 'system', content: `[Extension ${m.extensionName}] ${m.content}` }
      }
      if (m.role === 'user') {
        return { role: 'user', content: m.content, attachments: m.attachments }
      }
      return { role: 'assistant', content: m.content }
    })
}

// If a compressed snapshot is present and the prefix it claims to replace is
// still all there, substitute it in. Anything appended after compression flows
// through verbatim.
export function substituteCompressionSnapshot(
  apiMessages: ApiMessage[],
  snapshot: { compressedMessages: CompressedApiMessage[]; compressedFromCount: number } | null
): ApiMessage[] {
  if (!snapshot || apiMessages.length < snapshot.compressedFromCount) return apiMessages
  const tail = apiMessages.slice(snapshot.compressedFromCount)
  return [
    ...snapshot.compressedMessages.map((m): ApiMessage => ({ role: m.role, content: m.content })),
    ...tail,
  ]
}

// Mid-stream restart safety: any message that was marked `streaming` when the
// session was saved must have been interrupted by a crash/exit. Mark them
// non-streaming and (if they had no content) substitute an `[interrupted]`
// note. Same applies to unanswered ask_user prompts.
export function sanitizeLoadedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if ((m.role === 'assistant' || m.role === 'thinking') && (m as AssistantMessage).streaming) {
      return {
        ...m,
        streaming: false,
        content: (m as AssistantMessage).content || '[interrupted]',
      }
    }
    if (m.role === 'ask_user' && (m as AskUserMessage).answer === null) {
      return { ...m, answer: '[interrupted]' }
    }
    return m
  })
}
