import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry, type ToolSourceContext, type SubagentTurnContext } from '../toolRegistry'
import type { ExtensionManifest, ExtensionToolEntry, ExtensionToolCtx } from '../../../shared/extension-types'

// The registry's tool-map is Record<string, any>; tests use plain
// placeholder objects since the registry treats them opaquely.
function makeCoreBuilder(names: string[]) {
  return (ctx: ToolSourceContext) => {
    const out: Record<string, unknown> = {}
    for (const n of names) out[n] = { source: 'core', ctx }
    return out
  }
}

function makeExtensionEntry(name: string): ExtensionToolEntry {
  return {
    name,
    description: `desc:${name}`,
    schema: {},
    execute: async () => `result:${name}`
  }
}

function makeManifest(id: string, toolNames: string[]): ExtensionManifest {
  return {
    id,
    name: id,
    version: '0.0.0',
    description: '',
    author: '',
    provides: {
      agentTools: true,
      tools: toolNames.map((n) => ({ name: n, displayName: n, description: '' }))
    }
  }
}

function baseCtx(overrides: Partial<ToolSourceContext> = {}): ToolSourceContext {
  const toolCtx: ExtensionToolCtx = { sessionId: 'sess-1', turnId: undefined }
  return {
    rootPath: '/proj',
    emit: () => {},
    toolCtx,
    ...overrides
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  // (1)
  it('returns only the registered core tool names for include: ["core"]', () => {
    registry.registerCoreTools(makeCoreBuilder(['read_file', 'write_file', 'run_command']))
    const tools = registry.getToolsForSession({ ...baseCtx(), include: ['core'] })
    expect(Object.keys(tools).sort()).toEqual(['read_file', 'run_command', 'write_file'])
  })

  // (2)
  it('returns extension tools for an enabled extension id', () => {
    registry.registerCoreTools(makeCoreBuilder(['read_file']))
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('do_a')])
    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['core', 'extension'],
      enabledExtensionIds: ['ext-a']
    })
    expect(Object.keys(tools).sort()).toEqual(['do_a', 'read_file'])
  })

  // (3)
  it('omits tools for an extension id not in enabledExtensionIds', () => {
    registry.registerCoreTools(makeCoreBuilder(['read_file']))
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('do_a')])
    registry.registerExtensionTools('ext-b', '/proj', [makeExtensionEntry('do_b')])
    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['extension'],
      enabledExtensionIds: ['ext-a']
    })
    expect(Object.keys(tools)).toEqual(['do_a'])
    expect(tools).not.toHaveProperty('do_b')
  })

  // (4)
  it('unregisterExtension removes the extension tools', () => {
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('do_a')])
    registry.unregisterExtension('ext-a', '/proj')
    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['extension'],
      enabledExtensionIds: ['ext-a']
    })
    expect(tools).toEqual({})
  })

  // (5)
  it('invokes the subagent and skill factories with the right context', () => {
    const seenSubagent: { ctx: ToolSourceContext; turn: SubagentTurnContext }[] = []
    const seenSkill: ToolSourceContext[] = []

    registry.registerSubagentSource((ctx, turn) => {
      seenSubagent.push({ ctx, turn })
      return { create_subagents: { source: 'subagent' } }
    })
    registry.registerSkillSource((ctx) => {
      seenSkill.push(ctx)
      return { list_skills: { source: 'skill' }, load_skill: { source: 'skill' } }
    })

    const subagentTurn = {
      // Cast through unknown because the test doesn't need full type fidelity
      // for these dependencies — only that the factory receives the object.
      agentCtx: { tag: 'agentCtx' } as unknown,
      model: { tag: 'model' } as unknown,
      ollamaBaseUrl: 'http://ollama',
      counter: { value: 0 } as unknown,
      systemPrompt: 'sys'
    } as unknown as SubagentTurnContext

    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['subagent', 'skill'],
      subagent: subagentTurn
    })

    expect(Object.keys(tools).sort()).toEqual(['create_subagents', 'list_skills', 'load_skill'])
    expect(seenSubagent).toHaveLength(1)
    expect(seenSubagent[0].turn).toBe(subagentTurn)
    expect(seenSubagent[0].ctx.rootPath).toBe('/proj')
    expect(seenSkill).toHaveLength(1)
    expect(seenSkill[0].toolCtx.sessionId).toBe('sess-1')
  })

  // (6)
  it('disabledTools removes names regardless of source', () => {
    registry.registerCoreTools(makeCoreBuilder(['read_file', 'run_command']))
    registry.registerSubagentSource(() => ({ create_subagents: {} }))
    registry.registerSkillSource(() => ({ list_skills: {} }))
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('do_a')])

    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['core', 'extension', 'subagent', 'skill'],
      enabledExtensionIds: ['ext-a'],
      subagent: {} as unknown as SubagentTurnContext,
      disabledTools: ['read_file', 'create_subagents', 'list_skills', 'do_a']
    })

    expect(tools).toHaveProperty('run_command')
    expect(tools).not.toHaveProperty('read_file')
    expect(tools).not.toHaveProperty('create_subagents')
    expect(tools).not.toHaveProperty('list_skills')
    expect(tools).not.toHaveProperty('do_a')
  })

  // (7)
  it('runAgentOnce-shaped include set ["core", "extension"] excludes subagent and skill', () => {
    registry.registerCoreTools(makeCoreBuilder(['read_file']))
    registry.registerSubagentSource(() => ({ create_subagents: {}, explore: {} }))
    registry.registerSkillSource(() => ({ list_skills: {}, load_skill: {} }))
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('do_a')])

    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['core', 'extension'],
      enabledExtensionIds: ['ext-a']
    })

    expect(Object.keys(tools).sort()).toEqual(['do_a', 'read_file'])
    expect(tools).not.toHaveProperty('create_subagents')
    expect(tools).not.toHaveProperty('explore')
    expect(tools).not.toHaveProperty('list_skills')
    expect(tools).not.toHaveProperty('load_skill')
  })

  // (8)
  it('assertManifestMatches throws when runtime is missing manifest names or has extras', () => {
    // Missing-runtime: manifest declares "foo" + "bar"; runtime registers only "foo".
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('foo')])
    expect(() =>
      registry.assertManifestMatches('ext-a', '/proj', makeManifest('ext-a', ['foo', 'bar']))
    ).toThrow(/bar/)

    // Extra-runtime: manifest declares "foo"; runtime registers "foo" + "baz".
    registry.registerExtensionTools('ext-b', '/proj', [
      makeExtensionEntry('foo'),
      makeExtensionEntry('baz')
    ])
    expect(() =>
      registry.assertManifestMatches('ext-b', '/proj', makeManifest('ext-b', ['foo']))
    ).toThrow(/baz/)
  })

  // (9)
  it('assertManifestMatches returns clean when names match exactly', () => {
    registry.registerExtensionTools('ext-a', '/proj', [
      makeExtensionEntry('foo'),
      makeExtensionEntry('bar')
    ])
    const drift = registry.assertManifestMatches('ext-a', '/proj', makeManifest('ext-a', ['foo', 'bar']))
    expect(drift.declaredButNotRegistered).toEqual([])
    expect(drift.registeredButNotDeclared).toEqual([])
  })

  // (10)
  it('two extensions under the same rootPath register independently', () => {
    registry.registerExtensionTools('ext-a', '/proj', [makeExtensionEntry('do_a')])
    registry.registerExtensionTools('ext-b', '/proj', [makeExtensionEntry('do_b')])

    const tools = registry.getToolsForSession({
      ...baseCtx(),
      include: ['extension'],
      enabledExtensionIds: ['ext-a', 'ext-b']
    })
    expect(Object.keys(tools).sort()).toEqual(['do_a', 'do_b'])

    registry.unregisterExtension('ext-a', '/proj')
    const afterUnregister = registry.getToolsForSession({
      ...baseCtx(),
      include: ['extension'],
      enabledExtensionIds: ['ext-a', 'ext-b']
    })
    expect(Object.keys(afterUnregister)).toEqual(['do_b'])
  })
})
