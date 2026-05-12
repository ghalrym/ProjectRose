import type {
  ChatMessage,
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  AskUserMessage,
  InjectedMessage,
} from '../types/chatMessages'

export interface TimelineSlice {
  messages: ChatMessage[]
  assistantPlaceholderId: string | null
  thinkingPlaceholderId: string | null
  pendingModelDisplay: string | null
  isLoading: boolean
}

export const emptyTimeline: TimelineSlice = {
  messages: [],
  assistantPlaceholderId: null,
  thinkingPlaceholderId: null,
  pendingModelDisplay: null,
  isLoading: false,
}

function insertBefore(messages: ChatMessage[], targetId: string, insert: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === targetId)
  if (idx < 0) return [...messages, insert]
  return [...messages.slice(0, idx), insert, ...messages.slice(idx)]
}

function sealStreamingPlaceholders(slice: TimelineSlice): ChatMessage[] {
  return slice.messages.map((m) => {
    if (m.id === slice.thinkingPlaceholderId && m.role === 'thinking') return { ...m, streaming: false }
    if (m.id === slice.assistantPlaceholderId && m.role === 'assistant') return { ...m, streaming: false }
    return m
  })
}

export function applyToken(
  slice: TimelineSlice,
  data: { token: string; newId: string; timestamp: number }
): TimelineSlice {
  if (slice.assistantPlaceholderId) {
    return {
      ...slice,
      messages: slice.messages.map((m) =>
        m.id === slice.assistantPlaceholderId && m.role === 'assistant'
          ? { ...m, content: m.content + data.token }
          : m
      ),
    }
  }
  const msg: AssistantMessage = {
    id: data.newId,
    role: 'assistant',
    content: data.token,
    timestamp: data.timestamp,
    streaming: true,
    modelDisplay: slice.pendingModelDisplay ?? undefined,
  }
  return {
    ...slice,
    messages: [...slice.messages, msg],
    assistantPlaceholderId: data.newId,
  }
}

export function applyToolStart(
  slice: TimelineSlice,
  data: { id: string; name: string; params: Record<string, unknown>; newId: string; timestamp: number }
): TimelineSlice {
  const toolMsg: ToolMessage = {
    id: data.newId,
    role: 'tool',
    timestamp: data.timestamp,
    toolId: data.id,
    name: data.name,
    params: data.params,
    result: null,
    error: false,
    pending: true,
  }
  return {
    ...slice,
    messages: [...sealStreamingPlaceholders(slice), toolMsg],
    thinkingPlaceholderId: null,
    assistantPlaceholderId: null,
  }
}

export function applyToolEnd(
  slice: TimelineSlice,
  data: { id: string; result: string; error: boolean }
): TimelineSlice {
  return {
    ...slice,
    messages: slice.messages.map((m) =>
      m.role === 'tool' && m.toolId === data.id
        ? { ...m, result: data.result, error: data.error, pending: false }
        : m
    ),
  }
}

export function applyThinking(
  slice: TimelineSlice,
  data: { content: string; newId: string; timestamp: number }
): TimelineSlice {
  if (slice.thinkingPlaceholderId) {
    return {
      ...slice,
      messages: slice.messages.map((m) =>
        m.id === slice.thinkingPlaceholderId && m.role === 'thinking'
          ? { ...m, content: m.content + data.content }
          : m
      ),
    }
  }
  const msg: ThinkingMessage = {
    id: data.newId,
    role: 'thinking',
    timestamp: data.timestamp,
    content: data.content,
    streaming: true,
  }
  return {
    ...slice,
    messages: slice.assistantPlaceholderId
      ? insertBefore(slice.messages, slice.assistantPlaceholderId, msg)
      : [...slice.messages, msg],
    thinkingPlaceholderId: data.newId,
  }
}

export function applyAskUser(
  slice: TimelineSlice,
  data: { questionId: string; question: string; options: string[]; newId: string; timestamp: number }
): TimelineSlice {
  const msg: AskUserMessage = {
    id: data.newId,
    role: 'ask_user',
    timestamp: data.timestamp,
    questionId: data.questionId,
    question: data.question,
    options: data.options,
    answer: null,
  }
  return {
    ...slice,
    messages: [...sealStreamingPlaceholders(slice), msg],
    thinkingPlaceholderId: null,
    assistantPlaceholderId: null,
  }
}

export function applyAnswerAskUser(
  slice: TimelineSlice,
  data: { questionId: string; answer: string }
): TimelineSlice {
  return {
    ...slice,
    messages: slice.messages.map((m) =>
      m.role === 'ask_user' && m.questionId === data.questionId
        ? { ...m, answer: data.answer }
        : m
    ),
  }
}

export function applyInjectedMessage(
  slice: TimelineSlice,
  data: {
    extensionId: string
    extensionName: string
    extensionIcon?: string
    content: string
    newId: string
    timestamp: number
  }
): TimelineSlice {
  const msg: InjectedMessage = {
    id: data.newId,
    role: 'injected',
    timestamp: data.timestamp,
    content: data.content,
    extensionId: data.extensionId,
    extensionName: data.extensionName,
    extensionIcon: data.extensionIcon,
  }
  return {
    ...slice,
    messages: [...sealStreamingPlaceholders(slice), msg],
    thinkingPlaceholderId: null,
    assistantPlaceholderId: null,
  }
}

export function applyModelSelected(
  slice: TimelineSlice,
  data: { modelDisplay: string }
): TimelineSlice {
  if (slice.assistantPlaceholderId) {
    return {
      ...slice,
      messages: slice.messages.map((m) =>
        m.id === slice.assistantPlaceholderId && m.role === 'assistant'
          ? { ...m, modelDisplay: data.modelDisplay }
          : m
      ),
    }
  }
  return { ...slice, pendingModelDisplay: data.modelDisplay }
}

export function applyStreamReset(
  slice: TimelineSlice,
  data: { fallbackModel: string; errorMessage: string }
): TimelineSlice {
  if (!slice.assistantPlaceholderId) return slice
  return {
    ...slice,
    messages: slice.messages.map((m) =>
      m.id === slice.assistantPlaceholderId && m.role === 'assistant'
        ? {
            ...m,
            content: '',
            modelDisplay: data.fallbackModel,
            fallbackNotice: `${m.modelDisplay ?? 'Model'} failed: ${data.errorMessage}`,
          }
        : m
    ),
  }
}

export function applyStartTurn(slice: TimelineSlice, userMessage: ChatMessage): TimelineSlice {
  return {
    ...slice,
    messages: [...slice.messages, userMessage],
    isLoading: true,
    assistantPlaceholderId: null,
    thinkingPlaceholderId: null,
    pendingModelDisplay: null,
  }
}

export function applyTurnSettled(
  slice: TimelineSlice,
  data: { modelDisplay: string }
): TimelineSlice {
  const placeholderId = slice.assistantPlaceholderId
  return {
    ...slice,
    messages: slice.messages.map((m) => {
      if (m.id === placeholderId && m.role === 'assistant') {
        return { ...m, streaming: false, modelDisplay: data.modelDisplay }
      }
      if (m.role === 'thinking' && (m as ThinkingMessage).streaming) {
        return { ...m, streaming: false }
      }
      return m
    }),
    isLoading: false,
    assistantPlaceholderId: null,
    thinkingPlaceholderId: null,
    pendingModelDisplay: null,
  }
}

export function applyAbortCleanup(slice: TimelineSlice): TimelineSlice {
  const placeholderId = slice.assistantPlaceholderId
  return {
    ...slice,
    messages: slice.messages.map((m) => {
      if (m.id === placeholderId && m.role === 'assistant') return { ...m, streaming: false }
      if (m.role === 'thinking' && (m as ThinkingMessage).streaming) return { ...m, streaming: false }
      if (m.role === 'ask_user' && (m as AskUserMessage).answer === null) return { ...m, answer: '[cancelled]' }
      return m
    }),
    isLoading: false,
    assistantPlaceholderId: null,
    thinkingPlaceholderId: null,
    pendingModelDisplay: null,
  }
}

export function applyErrorCleanup(
  slice: TimelineSlice,
  data: { errorContent: string; newId: string; timestamp: number }
): TimelineSlice {
  const placeholderId = slice.assistantPlaceholderId
  if (placeholderId) {
    return {
      ...slice,
      messages: slice.messages.map((m) => {
        if (m.id === placeholderId && m.role === 'assistant') {
          return { ...m, content: data.errorContent, streaming: false, isError: true }
        }
        if (m.role === 'thinking' && (m as ThinkingMessage).streaming) {
          return { ...m, streaming: false }
        }
        return m
      }),
      isLoading: false,
      assistantPlaceholderId: null,
      thinkingPlaceholderId: null,
      pendingModelDisplay: null,
    }
  }
  const errorMsg: AssistantMessage = {
    id: data.newId,
    role: 'assistant',
    content: data.errorContent,
    timestamp: data.timestamp,
    streaming: false,
    isError: true,
  }
  return {
    ...slice,
    messages: [
      ...slice.messages.map((m) =>
        m.role === 'thinking' && (m as ThinkingMessage).streaming ? { ...m, streaming: false } : m
      ),
      errorMsg,
    ],
    isLoading: false,
    assistantPlaceholderId: null,
    thinkingPlaceholderId: null,
    pendingModelDisplay: null,
  }
}
