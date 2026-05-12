import { describe, it, expect } from 'vitest'
import {
  diffToolCatalog,
  reconcileToolCatalog,
  ToolCatalogDriftError
} from '../reconcileToolCatalog'
import type { ExtensionManifest, ExtensionToolEntry } from '../../../shared/extension-types'

function manifest(toolNames: string[]): ExtensionManifest {
  return {
    id: 'rose-fake',
    name: 'Fake',
    version: '1.0.0',
    description: 'd',
    author: 'a',
    provides: {
      main: true,
      agentTools: toolNames.length > 0,
      tools: toolNames.map((name) => ({
        name,
        displayName: name,
        description: name
      }))
    }
  }
}

function entry(name: string): ExtensionToolEntry {
  return {
    name,
    description: name,
    schema: { type: 'object', properties: {} },
    execute: async () => 'ok'
  }
}

describe('diffToolCatalog', () => {
  it('returns empty drift when manifest and runtime agree', () => {
    const drift = diffToolCatalog(manifest(['a', 'b']), [entry('a'), entry('b')])
    expect(drift.declaredButNotRegistered).toEqual([])
    expect(drift.registeredButNotDeclared).toEqual([])
  })

  it('lists tools declared but not registered', () => {
    const drift = diffToolCatalog(manifest(['a', 'b', 'c']), [entry('a')])
    expect(drift.declaredButNotRegistered.sort()).toEqual(['b', 'c'])
    expect(drift.registeredButNotDeclared).toEqual([])
  })

  it('lists tools registered but not declared', () => {
    const drift = diffToolCatalog(manifest(['a']), [entry('a'), entry('b'), entry('c')])
    expect(drift.declaredButNotRegistered).toEqual([])
    expect(drift.registeredButNotDeclared.sort()).toEqual(['b', 'c'])
  })

  it('handles a manifest with no tools at all', () => {
    const drift = diffToolCatalog(manifest([]), [entry('a')])
    expect(drift.registeredButNotDeclared).toEqual(['a'])
    expect(drift.declaredButNotRegistered).toEqual([])
  })

  it('handles runtime registering nothing for a manifest that declares tools', () => {
    const drift = diffToolCatalog(manifest(['a', 'b']), [])
    expect(drift.declaredButNotRegistered.sort()).toEqual(['a', 'b'])
  })
})

describe('reconcileToolCatalog (strict)', () => {
  it('is silent when there is no drift', () => {
    expect(() => reconcileToolCatalog('rose-fake', manifest(['a']), [entry('a')])).not.toThrow()
  })

  it('throws ToolCatalogDriftError on declared-but-not-registered', () => {
    expect(() => reconcileToolCatalog('rose-fake', manifest(['a', 'b']), [entry('a')]))
      .toThrow(ToolCatalogDriftError)
    try {
      reconcileToolCatalog('rose-fake', manifest(['a', 'b']), [entry('a')])
    } catch (err) {
      const e = err as ToolCatalogDriftError
      expect(e.extensionId).toBe('rose-fake')
      expect(e.drift.declaredButNotRegistered).toEqual(['b'])
      expect(e.message).toMatch(/manifest declares.*b/)
    }
  })

  it('throws ToolCatalogDriftError on registered-but-not-declared', () => {
    expect(() => reconcileToolCatalog('rose-fake', manifest(['a']), [entry('a'), entry('stealth')]))
      .toThrow(ToolCatalogDriftError)
    try {
      reconcileToolCatalog('rose-fake', manifest(['a']), [entry('a'), entry('stealth')])
    } catch (err) {
      const e = err as ToolCatalogDriftError
      expect(e.drift.registeredButNotDeclared).toEqual(['stealth'])
      expect(e.message).toMatch(/missing from manifest.*stealth/)
    }
  })

  it('throws a single error with both sides listed when both drift', () => {
    try {
      reconcileToolCatalog(
        'rose-fake',
        manifest(['a', 'declared-only']),
        [entry('a'), entry('registered-only')]
      )
      expect.fail('expected throw')
    } catch (err) {
      const e = err as ToolCatalogDriftError
      expect(e.drift.declaredButNotRegistered).toEqual(['declared-only'])
      expect(e.drift.registeredButNotDeclared).toEqual(['registered-only'])
      expect(e.message).toMatch(/declared-only/)
      expect(e.message).toMatch(/registered-only/)
    }
  })
})
