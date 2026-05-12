import { describe, it, expect } from 'vitest'
import {
  buildApiMessages,
  substituteCompressionSnapshot,
  sanitizeLoadedMessages,
  settledMessages,
  type ApiMessage,
} from '../chatApiMessages'
import type {
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  InjectedMessage,
  AskUserMessage,
  ToolMessage,
  CompressedApiMessage,
} from '../../types/chatMessages'

function u(id: string, content: string): UserMessage {
  return { id, role: 'user', content, timestamp: 0 }
}
function a(id: string, content: string, streaming = false): AssistantMessage {
  return { id, role: 'assistant', content, timestamp: 0, streaming }
}
function think(id: string, content: string, streaming = false): ThinkingMessage {
  return { id, role: 'thinking', content, timestamp: 0, streaming }
}
function inj(id: string, name: string, content: string): InjectedMessage {
  return { id, role: 'injected', content, timestamp: 0, extensionId: name, extensionName: name }
}
function tool(id: string, toolId: string): ToolMessage {
  return {
    id,
    role: 'tool',
    toolId,
    name: 'x',
    params: {},
    result: 'ok',
    error: false,
    pending: false,
    timestamp: 0,
  }
}
function ask(id: string, qid: string): AskUserMessage {
  return {
    id,
    role: 'ask_user',
    questionId: qid,
    question: 'q',
    options: [],
    answer: null,
    timestamp: 0,
  }
}

describe('settledMessages', () => {
  it('drops streaming assistant and thinking', () => {
    const messages: ChatMessage[] = [
      u('u1', 'hi'),
      a('a1', 'partial', true),
      think('t1', 'mid', true),
      a('a2', 'done', false),
    ]
    expect(settledMessages(messages).map((m) => m.id)).toEqual(['u1', 'a2'])
  })

  it('keeps non-streaming assistant/thinking', () => {
    const messages: ChatMessage[] = [a('a1', 'done', false), think('t1', 'done', false)]
    expect(settledMessages(messages)).toHaveLength(2)
  })
})

describe('buildApiMessages — includeThinking=false', () => {
  it('emits user/assistant/injected→system and skips thinking', () => {
    const messages: ChatMessage[] = [
      u('u1', 'hi'),
      think('t1', 'thinking', false),
      a('a1', 'hello', false),
      inj('inj1', 'rose-git', 'commit landed'),
    ]
    expect(buildApiMessages(messages, false)).toEqual<ApiMessage[]>([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'system', content: '[Extension rose-git] commit landed' },
    ])
  })

  it('skips tool and ask_user messages', () => {
    const messages: ChatMessage[] = [u('u1', 'q'), tool('m1', 't1'), ask('m2', 'q1'), a('a1', 'ans')]
    expect(buildApiMessages(messages, false).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('preserves attachments on user messages', () => {
    const attachments = [{ dataUrl: 'data:x', kind: 'screen' as const, mimeType: 'image/jpeg' }]
    const messages: ChatMessage[] = [{ ...u('u1', 'hi'), attachments }]
    const out = buildApiMessages(messages, false)
    expect(out[0]).toMatchObject({ role: 'user', content: 'hi', attachments })
  })

  it('drops streaming messages before emitting', () => {
    const messages: ChatMessage[] = [u('u1', 'hi'), a('a1', 'partial', true)]
    expect(buildApiMessages(messages, false)).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('buildApiMessages — includeThinking=true', () => {
  it('weaves thinking into the next assistant message inside <thinking>', () => {
    const messages: ChatMessage[] = [
      u('u1', 'hi'),
      think('t1', 'first thought', false),
      a('a1', 'hello', false),
    ]
    expect(buildApiMessages(messages, true)).toEqual<ApiMessage[]>([
      { role: 'user', content: 'hi', attachments: undefined },
      { role: 'assistant', content: '<thinking>\nfirst thought\n</thinking>\n\nhello' },
    ])
  })

  it('concatenates multiple thinking blocks with a blank line between', () => {
    const messages: ChatMessage[] = [
      u('u1', 'q'),
      think('t1', 'one', false),
      think('t2', 'two', false),
      a('a1', 'done', false),
    ]
    const out = buildApiMessages(messages, true)
    expect((out[1] as ApiMessage).content).toBe('<thinking>\none\n\ntwo\n</thinking>\n\ndone')
  })

  it('emits a bare assistant message when no pending thinking precedes it', () => {
    const messages: ChatMessage[] = [u('u1', 'q'), a('a1', 'done', false)]
    const out = buildApiMessages(messages, true)
    expect((out[1] as ApiMessage).content).toBe('done')
  })

  it('resets pending thinking when a user message arrives', () => {
    const messages: ChatMessage[] = [
      think('t1', 'orphan', false),
      u('u1', 'q'),
      a('a1', 'ans', false),
    ]
    const out = buildApiMessages(messages, true)
    // Orphan thinking is discarded because user resets pendingThinking before
    // any assistant message could attach it.
    expect(out).toEqual([
      { role: 'user', content: 'q', attachments: undefined },
      { role: 'assistant', content: 'ans' },
    ])
  })

  it('resets pending thinking when an injected message arrives', () => {
    const messages: ChatMessage[] = [
      think('t1', 'orphan', false),
      inj('inj1', 'rose-git', 'note'),
      a('a1', 'ans', false),
    ]
    const out = buildApiMessages(messages, true)
    expect(out).toEqual([
      { role: 'system', content: '[Extension rose-git] note' },
      { role: 'assistant', content: 'ans' },
    ])
  })
})

describe('substituteCompressionSnapshot', () => {
  const snap: CompressedApiMessage[] = [
    { role: 'system', content: 'summary' },
    { role: 'assistant', content: 'recap' },
  ]

  it('returns input unchanged when snapshot is null', () => {
    const api: ApiMessage[] = [{ role: 'user', content: 'hi' }]
    expect(substituteCompressionSnapshot(api, null)).toEqual(api)
  })

  it('replaces the leading N messages with the snapshot prefix', () => {
    const api: ApiMessage[] = [
      { role: 'user', content: 'old1' },
      { role: 'assistant', content: 'old2' },
      { role: 'user', content: 'old3' },
      { role: 'user', content: 'new' },
    ]
    const out = substituteCompressionSnapshot(api, {
      compressedMessages: snap,
      compressedFromCount: 3,
    })
    expect(out).toEqual([
      { role: 'system', content: 'summary' },
      { role: 'assistant', content: 'recap' },
      { role: 'user', content: 'new' },
    ])
  })

  it('fails open when the prefix has been truncated (apiMessages too short)', () => {
    const api: ApiMessage[] = [{ role: 'user', content: 'too' }]
    const out = substituteCompressionSnapshot(api, {
      compressedMessages: snap,
      compressedFromCount: 3,
    })
    expect(out).toEqual(api)
  })

  it('appends snapshot exactly when compressedFromCount equals apiMessages.length', () => {
    const api: ApiMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]
    const out = substituteCompressionSnapshot(api, {
      compressedMessages: snap,
      compressedFromCount: 2,
    })
    expect(out).toEqual(snap)
  })
})

describe('sanitizeLoadedMessages', () => {
  it('seals streaming assistant messages and substitutes [interrupted] when content is empty', () => {
    const messages: ChatMessage[] = [a('a1', '', true)]
    const out = sanitizeLoadedMessages(messages)
    expect(out[0]).toMatchObject({ streaming: false, content: '[interrupted]' })
  })

  it('seals streaming assistant messages but keeps non-empty content', () => {
    const messages: ChatMessage[] = [a('a1', 'partial', true)]
    const out = sanitizeLoadedMessages(messages)
    expect(out[0]).toMatchObject({ streaming: false, content: 'partial' })
  })

  it('seals streaming thinking messages similarly', () => {
    const messages: ChatMessage[] = [think('t1', '', true)]
    const out = sanitizeLoadedMessages(messages)
    expect(out[0]).toMatchObject({ streaming: false, content: '[interrupted]' })
  })

  it('marks unanswered ask_user as [interrupted]', () => {
    const messages: ChatMessage[] = [ask('ask1', 'q1')]
    const out = sanitizeLoadedMessages(messages)
    expect((out[0] as AskUserMessage).answer).toBe('[interrupted]')
  })

  it('leaves answered ask_user untouched', () => {
    const messages: ChatMessage[] = [{ ...ask('ask1', 'q1'), answer: 'kept' }]
    const out = sanitizeLoadedMessages(messages)
    expect((out[0] as AskUserMessage).answer).toBe('kept')
  })

  it('passes through non-streaming, non-ask_user messages unchanged', () => {
    const messages: ChatMessage[] = [u('u1', 'hi'), a('a1', 'done', false)]
    expect(sanitizeLoadedMessages(messages)).toEqual(messages)
  })
})
