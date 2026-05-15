import { describe, it, expect, vi, beforeEach } from 'vitest'

// All of these modules are pulled in by ChatSession.run() at load time and
// would otherwise reach into the filesystem / Electron IPC. The stubs return
// the minimum shape run() needs to walk the loop without crashing.
vi.mock('../../ipc/settingsHandlers', () => ({
  readSettings: vi.fn(async () => ({
    userName: 'tester',
    agentName: 'rose',
    models: [
      {
        id: 'm1',
        displayName: 'Fake Model',
        provider: 'anthropic',
        modelName: 'fake',
        tags: [],
      },
    ],
    defaultModelId: 'm1',
    hostMode: 'local',
    providerKeys: { anthropic: '', openai: '' },
    ollamaBaseUrl: '',
    openaiCompatBaseUrl: '',
    router: { enabled: false, modelName: '' },
    includeThinkingInContext: false,
  })),
}))
vi.mock('../../ipc/projectSettingsHandlers', () => ({
  readProjectSettings: vi.fn(async () => ({ disabledTools: [], disabledPrompts: [] })),
}))
vi.mock('../../ipc/extensionHandlers', () => ({
  listInstalledExtensions: vi.fn(async () => []),
}))
vi.mock('../extensionHooks', () => ({
  fireUserMessageHook: vi.fn(async () => {}),
}))
vi.mock('../skillService', () => ({
  getSessionSkillsPrompt: vi.fn(() => ''),
}))
vi.mock('../agentMd', () => ({
  buildAgentMd: vi.fn(async () => 'system-prompt'),
}))
vi.mock('../modelSelection', async () => {
  const actual = await vi.importActual<typeof import('../modelSelection')>(
    '../modelSelection'
  )
  return {
    ...actual,
    selectModel: vi.fn(async () => ({
      id: 'm1',
      displayName: 'Fake Model',
      provider: 'anthropic',
      modelName: 'fake',
      tags: [],
    })),
  }
})

import { ChatSession, type RunOnceFn } from '../chatSession'
import type { StreamResult } from '../llmClient'
import type { Message } from '../../../shared/roseModelTypes'
import type { ModelMessage } from 'ai'

describe('ChatSession.run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the fake LLM content as the ChatResponse content', async () => {
    const finalMessages: ModelMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello back' },
    ]
    const fakeStream: StreamResult = {
      content: 'hello back',
      inputTokens: 1,
      outputTokens: 2,
      finalMessages,
    }
    const runOnce: RunOnceFn = vi.fn(async () => fakeStream)

    const session = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const messages: Message[] = [{ role: 'user', content: 'hi' }]
    const response = await session.run({ messages, runOnce })

    expect(response.content).toBe('hello back')
    expect(response.modifiedFiles).toEqual([])
    expect(response.modelDisplay).toBe('Fake Model')
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('iterates the injection loop until no extension injection is produced', async () => {
    const baseFinal: ModelMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'first' },
    ]
    // First call collects an injection; second call settles with none.
    const calls: Array<number> = []
    const runOnce: RunOnceFn = vi.fn(async (args) => {
      calls.push(args.preBuiltCoreMessages?.length ?? 0)
      if (calls.length === 1) {
        args.collectInjections({
          extensionId: 'ext.test',
          extensionName: 'Test Ext',
          content: 'wake up',
          // The InjectionRecord shape carries an optional icon — omit it.
        } as Parameters<typeof args.collectInjections>[0])
      }
      return {
        content: calls.length === 2 ? 'second-final' : 'first',
        inputTokens: 0,
        outputTokens: 0,
        finalMessages: baseFinal,
      }
    })

    const session = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const response = await session.run({
      messages: [{ role: 'user', content: 'hi' }],
      runOnce,
    })

    expect(runOnce).toHaveBeenCalledTimes(2)
    // Iteration 1: no preBuilt yet (undefined → 0). Iteration 2: preBuilt is
    // baseFinal + one injection system msg (2 + 1 = 3).
    expect(calls).toEqual([0, 3])
    // The settled response reflects the LAST stream (no further injections).
    expect(response.content).toBe('second-final')
  })

  it('records files written during the turn on session.modifiedFiles', async () => {
    const runOnce: RunOnceFn = vi.fn(async () => {
      // Simulate a tool handler having pushed into the session's list.
      session.modifiedFiles.push('/proj/a.ts', '/proj/b.ts')
      return {
        content: 'wrote two',
        inputTokens: 0,
        outputTokens: 0,
        finalMessages: [],
      }
    })

    const session = new ChatSession({ sessionId: 's1', rootPath: '/proj' })
    const response = await session.run({
      messages: [{ role: 'user', content: 'write some files' }],
      runOnce,
    })

    expect(response.modifiedFiles).toEqual(['/proj/a.ts', '/proj/b.ts'])
  })

  it('emits AI_MODEL_SELECTED with the session id on the notify channel', async () => {
    const notify = vi.fn()
    const runOnce: RunOnceFn = vi.fn(async () => ({
      content: '',
      inputTokens: 0,
      outputTokens: 0,
      finalMessages: [],
    }))

    const session = new ChatSession({ sessionId: 'sess-x', rootPath: '/proj' })
    await session.run({
      messages: [{ role: 'user', content: 'hi' }],
      runOnce,
      notify,
    })

    const modelSelectedCall = notify.mock.calls.find(
      ([channel]) => channel === 'ai:modelSelected'
    )
    expect(modelSelectedCall).toBeDefined()
    expect(modelSelectedCall?.[1]).toMatchObject({ sessionId: 'sess-x' })
  })
})
