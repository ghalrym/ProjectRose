import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import {
  validateManifest,
  formatManifestIssues,
  CAPABILITY_KEYS,
  type Capability
} from '../extension-manifest-validator'

// Resolve the worktree's RoseExtensions/ regardless of how vitest is invoked.
// __dirname is .../ProjectRose/src/shared/__tests__, so up four = worktree root.
const WORKTREE_ROOT = join(__dirname, '..', '..', '..', '..')
const FIRST_PARTY_DIR = join(WORKTREE_ROOT, 'RoseExtensions')

function loadManifest(extensionDir: string): unknown {
  return JSON.parse(readFileSync(join(extensionDir, 'rose-extension.json'), 'utf-8'))
}

function firstPartyExtensions(): string[] {
  if (!existsSync(FIRST_PARTY_DIR)) return []
  return readdirSync(FIRST_PARTY_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(FIRST_PARTY_DIR, name, 'rose-extension.json')))
}

describe('extension-manifest-validator', () => {
  describe('first-party manifests', () => {
    const names = firstPartyExtensions()

    // Sanity: if this fires, submodules aren't checked out and the rest of
    // the file isn't really exercising anything.
    it('discovers all 12 first-party extensions', () => {
      expect(names.length).toBe(12)
    })

    for (const name of names) {
      it(`accepts ${name}/rose-extension.json`, () => {
        const raw = loadManifest(join(FIRST_PARTY_DIR, name))
        const result = validateManifest(raw)
        if (!result.ok) {
          throw new Error(`expected ${name} to validate, got errors: ${formatManifestIssues(result.errors)}`)
        }
        // First-party manifests should also have no warnings (no stray keys).
        expect(result.warnings).toEqual([])
        expect(result.manifest.id).toBe(name)
      })
    }
  })

  describe('capability surface', () => {
    it('exposes the 10 capability keys agreed in the PRD', () => {
      expect(CAPABILITY_KEYS).toEqual([
        'pageView',
        'main',
        'projectSettings',
        'globalSettings',
        'agentTools',
        'chatHooks',
        'agentSession',
        'backgroundAgent',
        'notifyStatus',
        'broadcast'
      ])
    })

    it('Capability type narrows to the exported keys', () => {
      const k: Capability = 'agentSession'
      expect(CAPABILITY_KEYS).toContain(k)
    })
  })

  describe('negative cases', () => {
    function base(): Record<string, unknown> {
      return {
        id: 'rose-fake',
        name: 'Fake',
        version: '1.0.0',
        description: 'd',
        author: 'a',
        provides: { main: true }
      }
    }

    it('rejects non-object input', () => {
      const r = validateManifest('not an object')
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors[0]?.message).toMatch(/object/i)
    })

    it('rejects null', () => {
      const r = validateManifest(null)
      expect(r.ok).toBe(false)
    })

    it('rejects missing id', () => {
      const m = base()
      delete m.id
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'id' && /missing/.test(e.message))).toBe(true)
    })

    it('rejects missing version', () => {
      const m = base()
      delete m.version
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'version')).toBe(true)
    })

    it('rejects missing provides', () => {
      const m = base()
      delete m.provides
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'provides')).toBe(true)
    })

    it('rejects non-boolean capability value', () => {
      const m = base()
      m.provides = { main: true, chatHooks: 'yes' }
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'provides.chatHooks')).toBe(true)
    })

    it('rejects malformed tools[] entry (missing name)', () => {
      const m = base()
      m.provides = {
        main: true,
        agentTools: true,
        tools: [{ displayName: 'X', description: 'Y' }]
      }
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'provides.tools[0].name')).toBe(true)
    })

    it('rejects duplicate tool names', () => {
      const m = base()
      m.provides = {
        main: true,
        agentTools: true,
        tools: [
          { name: 'dup', displayName: 'A', description: 'a' },
          { name: 'dup', displayName: 'B', description: 'b' }
        ]
      }
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => /duplicate/.test(e.message))).toBe(true)
    })

    it('rejects non-array tools', () => {
      const m = base()
      m.provides = { main: true, agentTools: true, tools: { name: 'x' } }
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'provides.tools')).toBe(true)
    })

    it('rejects navItem with missing label', () => {
      const m = base()
      m.navItem = { iconName: 'icon' }
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'navItem.label')).toBe(true)
    })

    it('rejects malformed systemPrompt (non-string)', () => {
      const m = base()
      m.provides = { main: true, systemPrompt: 42 }
      const r = validateManifest(m)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errors.some((e) => e.path === 'provides.systemPrompt')).toBe(true)
    })
  })

  describe('forward-compat warnings (HITL: unknown capability => warning, not error)', () => {
    it('warns on unknown capability key but still validates', () => {
      const m = {
        id: 'rose-fake',
        name: 'Fake',
        version: '1.0.0',
        description: 'd',
        author: 'a',
        provides: { main: true, futureCapabilityFromNewerHost: true }
      }
      const r = validateManifest(m)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.warnings.length).toBe(1)
      expect(r.warnings[0]?.path).toBe('provides.futureCapabilityFromNewerHost')
      expect(r.warnings[0]?.message).toMatch(/unknown capability/i)
    })

    it('does NOT warn on unknown top-level keys (manifest is open at the top)', () => {
      const m = {
        id: 'rose-fake',
        name: 'Fake',
        version: '1.0.0',
        description: 'd',
        author: 'a',
        engines: { node: '>=20' },
        repository: 'https://example.com',
        provides: { main: true }
      }
      const r = validateManifest(m)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.warnings).toEqual([])
    })
  })

  describe('formatManifestIssues', () => {
    it('joins issues with semicolons', () => {
      const s = formatManifestIssues([
        { path: 'id', message: 'missing' },
        { path: 'provides', message: 'must be object' }
      ])
      expect(s).toBe('id: missing; provides: must be object')
    })

    it('omits path prefix when path is empty', () => {
      const s = formatManifestIssues([{ path: '', message: 'manifest must be a JSON object' }])
      expect(s).toBe('manifest must be a JSON object')
    })
  })
})
