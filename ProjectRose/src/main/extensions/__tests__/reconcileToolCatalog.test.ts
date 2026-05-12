import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { diffToolCatalog, reconcileToolCatalog } from '../reconcileToolCatalog'
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

describe('reconcileToolCatalog', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('is silent when there is no drift', () => {
    reconcileToolCatalog('rose-fake', manifest(['a']), [entry('a')])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns on declared-but-not-registered', () => {
    reconcileToolCatalog('rose-fake', manifest(['a', 'b']), [entry('a')])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/manifest declares.*b/)
  })

  it('warns on registered-but-not-declared', () => {
    reconcileToolCatalog('rose-fake', manifest(['a']), [entry('a'), entry('stealth')])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/missing from manifest.*stealth/)
  })

  it('warns once on each side when both drift', () => {
    reconcileToolCatalog('rose-fake', manifest(['a', 'declared-only']), [entry('a'), entry('registered-only')])
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})
