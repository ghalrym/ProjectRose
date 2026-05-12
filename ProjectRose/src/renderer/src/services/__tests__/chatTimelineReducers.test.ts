import { describe, it, expect } from 'vitest'
import {
  applyToken,
  applyToolStart,
  applyToolEnd,
  applyThinking,
  applyAskUser,
  applyAnswerAskUser,
  applyInjectedMessage,
  applyModelSelected,
  applyStreamReset,
  applyStartTurn,
  applyTurnSettled,
  applyAbortCleanup,
  applyErrorCleanup,
  emptyTimeline,
  type TimelineSlice,
} from '../chatTimelineReducers'
import type {
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  AskUserMessage,
  UserMessage,
} from '../../types/chatMessages'

function assistant(id: string, content: string, streaming = false, modelDisplay?: string): AssistantMessage {
  return { id, role: 'assistant', content, timestamp: 0, streaming, modelDisplay }
}
function thinking(id: string, content: string, streaming = false): ThinkingMessage {
  return { id, role: 'thinking', content, timestamp: 0, streaming }
}
function tool(id: string, toolId: string, pending = false, result: string | null = 'ok'): ToolMessage {
  return {
    id,
    role: 'tool',
    toolId,
    name: 'read_file',
    params: {},
    result,
    error: false,
    pending,
    timestamp: 0,
  }
}
function ask(id: string, questionId: string, answer: string | null = null): AskUserMessage {
  return {
    id,
    role: 'ask_user',
    questionId,
    question: 'q?',
    options: [],
    answer,
    timestamp: 0,
  }
}
function user(id: string, content: string): UserMessage {
  return { id, role: 'user', content, timestamp: 0 }
}

describe('applyToken', () => {
  it('starts a new assistant placeholder when none is active', () => {
    const next = applyToken(emptyTimeline, { token: 'Hello', newId: 'a1', timestamp: 42 })
    expect(next.messages).toHaveLength(1)
    expect(next.assistantPlaceholderId).toBe('a1')
    const m = next.messages[0] as AssistantMessage
    expect(m).toMatchObject({ id: 'a1', role: 'assistant', content: 'Hello', streaming: true, timestamp: 42 })
  })

  it('extends the existing assistant placeholder when one is active', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'Hello', true)],
      assistantPlaceholderId: 'a1',
    }
    const next = applyToken(start, { token: ' world', newId: 'a2', timestamp: 99 })
    expect(next.messages).toHaveLength(1)
    expect(next.assistantPlaceholderId).toBe('a1')
    expect((next.messages[0] as AssistantMessage).content).toBe('Hello world')
  })

  it('attaches pendingModelDisplay to the new placeholder', () => {
    const start: TimelineSlice = { ...emptyTimeline, pendingModelDisplay: 'gpt-4' }
    const next = applyToken(start, { token: 'x', newId: 'a1', timestamp: 0 })
    expect((next.messages[0] as AssistantMessage).modelDisplay).toBe('gpt-4')
  })

  it('does not extend a non-assistant message that happens to share the id', () => {
    // Defensive: placeholder id should always point at an assistant message,
    // but the reducer should guard against role mismatches.
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [thinking('t1', 'thought', true)],
      assistantPlaceholderId: 't1',
    }
    const next = applyToken(start, { token: 'hi', newId: 'a1', timestamp: 0 })
    // Thinking message left untouched
    expect((next.messages[0] as ThinkingMessage).content).toBe('thought')
  })
})

describe('applyToolStart', () => {
  it('appends a pending tool message', () => {
    const next = applyToolStart(emptyTimeline, {
      id: 'tool-1',
      name: 'grep',
      params: { pattern: 'x' },
      newId: 'm1',
      timestamp: 7,
    })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({
      id: 'm1',
      role: 'tool',
      toolId: 'tool-1',
      name: 'grep',
      params: { pattern: 'x' },
      pending: true,
      error: false,
      result: null,
      timestamp: 7,
    })
  })

  it('seals an in-progress assistant placeholder', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'partial', true)],
      assistantPlaceholderId: 'a1',
    }
    const next = applyToolStart(start, {
      id: 't1',
      name: 'g',
      params: {},
      newId: 'm2',
      timestamp: 0,
    })
    expect((next.messages[0] as AssistantMessage).streaming).toBe(false)
    expect(next.assistantPlaceholderId).toBeNull()
  })

  it('seals an in-progress thinking placeholder', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [thinking('t1', 'partial', true)],
      thinkingPlaceholderId: 't1',
    }
    const next = applyToolStart(start, {
      id: 'x',
      name: 'g',
      params: {},
      newId: 'm2',
      timestamp: 0,
    })
    expect((next.messages[0] as ThinkingMessage).streaming).toBe(false)
    expect(next.thinkingPlaceholderId).toBeNull()
  })
})

describe('applyToolEnd', () => {
  it('resolves the matching tool by toolId', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [tool('m1', 'tool-1', true, null)],
    }
    const next = applyToolEnd(start, { id: 'tool-1', result: 'done', error: false })
    expect(next.messages[0]).toMatchObject({ pending: false, error: false, result: 'done' })
  })

  it('marks errored tools with error: true', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [tool('m1', 'tool-1', true, null)],
    }
    const next = applyToolEnd(start, { id: 'tool-1', result: 'boom', error: true })
    expect(next.messages[0]).toMatchObject({ pending: false, error: true, result: 'boom' })
  })

  it('is a no-op when toolId is unknown', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [tool('m1', 'tool-1', true, null)],
    }
    const next = applyToolEnd(start, { id: 'unknown', result: 'x', error: false })
    expect(next.messages).toEqual(start.messages)
  })
})

describe('applyThinking', () => {
  it('starts a thinking placeholder when none is active', () => {
    const next = applyThinking(emptyTimeline, { content: 'hmm', newId: 't1', timestamp: 5 })
    expect(next.thinkingPlaceholderId).toBe('t1')
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({ id: 't1', role: 'thinking', content: 'hmm', streaming: true })
  })

  it('extends an existing thinking placeholder', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [thinking('t1', 'first', true)],
      thinkingPlaceholderId: 't1',
    }
    const next = applyThinking(start, { content: ' more', newId: 'tNEW', timestamp: 0 })
    expect(next.thinkingPlaceholderId).toBe('t1')
    expect((next.messages[0] as ThinkingMessage).content).toBe('first more')
  })

  it('inserts a new thinking before the assistant placeholder when one is active', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [user('u1', 'q'), assistant('a1', 'partial', true)],
      assistantPlaceholderId: 'a1',
    }
    const next = applyThinking(start, { content: 'hmm', newId: 't1', timestamp: 0 })
    // Thinking should be inserted before the assistant message
    expect(next.messages.map((m) => m.id)).toEqual(['u1', 't1', 'a1'])
    expect(next.thinkingPlaceholderId).toBe('t1')
  })

  it('appends to the end when no assistant placeholder exists', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [user('u1', 'q')],
    }
    const next = applyThinking(start, { content: 'hmm', newId: 't1', timestamp: 0 })
    expect(next.messages.map((m) => m.id)).toEqual(['u1', 't1'])
  })
})

describe('applyAskUser', () => {
  it('appends a pending ask-user message and seals streaming', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'partial', true), thinking('t1', 'p', true)],
      assistantPlaceholderId: 'a1',
      thinkingPlaceholderId: 't1',
    }
    const next = applyAskUser(start, {
      questionId: 'q1',
      question: 'Continue?',
      options: ['Yes', 'No'],
      newId: 'ask1',
      timestamp: 0,
    })
    expect(next.messages).toHaveLength(3)
    expect((next.messages[0] as AssistantMessage).streaming).toBe(false)
    expect((next.messages[1] as ThinkingMessage).streaming).toBe(false)
    expect(next.messages[2]).toMatchObject({
      id: 'ask1',
      role: 'ask_user',
      questionId: 'q1',
      options: ['Yes', 'No'],
      answer: null,
    })
    expect(next.assistantPlaceholderId).toBeNull()
    expect(next.thinkingPlaceholderId).toBeNull()
  })
})

describe('applyAnswerAskUser', () => {
  it('sets the answer on the matching ask_user message', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [ask('ask1', 'q1'), ask('ask2', 'q2')],
    }
    const next = applyAnswerAskUser(start, { questionId: 'q2', answer: 'yes' })
    expect((next.messages[0] as AskUserMessage).answer).toBeNull()
    expect((next.messages[1] as AskUserMessage).answer).toBe('yes')
  })

  it('is a no-op when no matching question exists', () => {
    const start: TimelineSlice = { ...emptyTimeline, messages: [ask('ask1', 'q1')] }
    const next = applyAnswerAskUser(start, { questionId: 'unknown', answer: 'x' })
    expect(next.messages).toEqual(start.messages)
  })
})

describe('applyInjectedMessage', () => {
  it('appends and seals streaming', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'partial', true)],
      assistantPlaceholderId: 'a1',
    }
    const next = applyInjectedMessage(start, {
      extensionId: 'rose-discord',
      extensionName: 'Discord',
      content: 'ping',
      newId: 'inj1',
      timestamp: 0,
    })
    expect((next.messages[0] as AssistantMessage).streaming).toBe(false)
    expect(next.messages[1]).toMatchObject({
      id: 'inj1',
      role: 'injected',
      extensionId: 'rose-discord',
      content: 'ping',
    })
    expect(next.assistantPlaceholderId).toBeNull()
  })
})

describe('applyModelSelected', () => {
  it('stages pendingModelDisplay when no placeholder is active', () => {
    const next = applyModelSelected(emptyTimeline, { modelDisplay: 'claude' })
    expect(next.pendingModelDisplay).toBe('claude')
    expect(next.messages).toHaveLength(0)
  })

  it('updates the active assistant placeholder when one exists', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'x', true)],
      assistantPlaceholderId: 'a1',
    }
    const next = applyModelSelected(start, { modelDisplay: 'claude' })
    expect((next.messages[0] as AssistantMessage).modelDisplay).toBe('claude')
    expect(next.pendingModelDisplay).toBeNull()
  })
})

describe('applyStreamReset', () => {
  it('resets content and adds fallback notice on the active placeholder', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'some text', true, 'primary-model')],
      assistantPlaceholderId: 'a1',
    }
    const next = applyStreamReset(start, { fallbackModel: 'backup', errorMessage: '429' })
    expect(next.messages[0]).toMatchObject({
      content: '',
      modelDisplay: 'backup',
      fallbackNotice: 'primary-model failed: 429',
    })
  })

  it('is a no-op when no placeholder is active', () => {
    const next = applyStreamReset(emptyTimeline, { fallbackModel: 'b', errorMessage: 'e' })
    expect(next).toEqual(emptyTimeline)
  })

  it('falls back to a generic label when modelDisplay is missing', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'x', true)],
      assistantPlaceholderId: 'a1',
    }
    const next = applyStreamReset(start, { fallbackModel: 'b', errorMessage: 'e' })
    expect((next.messages[0] as AssistantMessage).fallbackNotice).toBe('Model failed: e')
  })
})

describe('applyStartTurn', () => {
  it('appends the user message, sets isLoading, and clears placeholders', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      assistantPlaceholderId: 'stale',
      thinkingPlaceholderId: 'stale-t',
      pendingModelDisplay: 'stale-model',
    }
    const next = applyStartTurn(start, user('u1', 'hi'))
    expect(next.isLoading).toBe(true)
    expect(next.assistantPlaceholderId).toBeNull()
    expect(next.thinkingPlaceholderId).toBeNull()
    expect(next.pendingModelDisplay).toBeNull()
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({ id: 'u1', content: 'hi' })
  })
})

describe('applyTurnSettled', () => {
  it('seals the active assistant placeholder and writes modelDisplay', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'done', true)],
      assistantPlaceholderId: 'a1',
      isLoading: true,
    }
    const next = applyTurnSettled(start, { modelDisplay: 'gpt-5' })
    expect(next.messages[0]).toMatchObject({
      streaming: false,
      modelDisplay: 'gpt-5',
    })
    expect(next.isLoading).toBe(false)
    expect(next.assistantPlaceholderId).toBeNull()
  })

  it('seals leftover streaming thinking messages too', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [thinking('t1', 'thinking', true), assistant('a1', 'done', true)],
      assistantPlaceholderId: 'a1',
      thinkingPlaceholderId: 't1',
      isLoading: true,
    }
    const next = applyTurnSettled(start, { modelDisplay: 'x' })
    expect((next.messages[0] as ThinkingMessage).streaming).toBe(false)
    expect((next.messages[1] as AssistantMessage).streaming).toBe(false)
    expect(next.thinkingPlaceholderId).toBeNull()
  })

  it('still clears flags when no assistant placeholder is set', () => {
    const start: TimelineSlice = { ...emptyTimeline, isLoading: true }
    const next = applyTurnSettled(start, { modelDisplay: 'x' })
    expect(next.isLoading).toBe(false)
    expect(next.assistantPlaceholderId).toBeNull()
  })
})

describe('applyAbortCleanup', () => {
  it('marks unanswered ask_user as [cancelled]', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [ask('ask1', 'q1', null), ask('ask2', 'q2', 'kept')],
      isLoading: true,
    }
    const next = applyAbortCleanup(start)
    expect((next.messages[0] as AskUserMessage).answer).toBe('[cancelled]')
    expect((next.messages[1] as AskUserMessage).answer).toBe('kept')
  })

  it('seals streaming on assistant and thinking', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [thinking('t1', 'mid', true), assistant('a1', 'partial', true)],
      assistantPlaceholderId: 'a1',
      thinkingPlaceholderId: 't1',
      isLoading: true,
    }
    const next = applyAbortCleanup(start)
    expect((next.messages[0] as ThinkingMessage).streaming).toBe(false)
    expect((next.messages[1] as AssistantMessage).streaming).toBe(false)
    expect(next.isLoading).toBe(false)
    expect(next.assistantPlaceholderId).toBeNull()
    expect(next.thinkingPlaceholderId).toBeNull()
  })
})

describe('applyErrorCleanup', () => {
  it('replaces the active placeholder with the error and marks isError', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [assistant('a1', 'partial', true)],
      assistantPlaceholderId: 'a1',
      isLoading: true,
    }
    const next = applyErrorCleanup(start, {
      errorContent: 'Error: boom',
      newId: 'err1',
      timestamp: 0,
    })
    expect(next.messages[0]).toMatchObject({
      content: 'Error: boom',
      isError: true,
      streaming: false,
    })
    expect(next.isLoading).toBe(false)
  })

  it('appends a fresh error message when no placeholder exists', () => {
    const start: TimelineSlice = { ...emptyTimeline, isLoading: true }
    const next = applyErrorCleanup(start, {
      errorContent: 'Error: boom',
      newId: 'err1',
      timestamp: 7,
    })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({
      id: 'err1',
      role: 'assistant',
      content: 'Error: boom',
      isError: true,
      streaming: false,
      timestamp: 7,
    })
    expect(next.isLoading).toBe(false)
  })

  it('seals leftover streaming thinking when appending a fresh error', () => {
    const start: TimelineSlice = {
      ...emptyTimeline,
      messages: [thinking('t1', 'partial', true)],
      thinkingPlaceholderId: 't1',
      isLoading: true,
    }
    const next = applyErrorCleanup(start, {
      errorContent: 'Error: x',
      newId: 'err1',
      timestamp: 0,
    })
    expect((next.messages[0] as ThinkingMessage).streaming).toBe(false)
    expect(next.messages).toHaveLength(2)
  })
})
