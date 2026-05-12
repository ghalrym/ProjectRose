// Tool-catalog reconciliation.
//
// The manifest's `provides.tools[]` is display metadata that drives the
// Settings -> Tools UI and the `disabledTools` machinery. The runtime
// `ctx.registerTools(...)` registers the actual `execute` functions. The
// two are the same thing under different views — the contract is now
// strict: every name on one side must appear on the other.
//
// Drift modes (now hard errors at load time):
//   - A tool declared in the manifest but never registered: the Settings
//     UI would show a row the agent will never see.
//   - A tool registered at runtime but absent from the manifest: the
//     Settings UI would silently hide a tool the agent CAN see — a
//     stealth tool the user can't toggle.
//
// In both cases the host refuses the load. The legacy warning-only mode
// (#30/#31) ran while the 12 first-party extensions were migrating. #37
// flipped this to enforcement.

import type { ExtensionManifest, ExtensionToolEntry } from '../../shared/extension-types'

export interface ToolCatalogDrift {
  declaredButNotRegistered: string[]
  registeredButNotDeclared: string[]
}

export function diffToolCatalog(
  manifest: ExtensionManifest,
  registered: ExtensionToolEntry[]
): ToolCatalogDrift {
  const declared = new Set((manifest.provides.tools ?? []).map((t) => t.name))
  const live = new Set(registered.map((t) => t.name))

  const declaredButNotRegistered: string[] = []
  for (const name of declared) if (!live.has(name)) declaredButNotRegistered.push(name)

  const registeredButNotDeclared: string[] = []
  for (const name of live) if (!declared.has(name)) registeredButNotDeclared.push(name)

  return { declaredButNotRegistered, registeredButNotDeclared }
}

export class ToolCatalogDriftError extends Error {
  constructor(public readonly extensionId: string, public readonly drift: ToolCatalogDrift) {
    super(formatDriftMessage(extensionId, drift))
    this.name = 'ToolCatalogDriftError'
  }
}

function formatDriftMessage(extensionId: string, drift: ToolCatalogDrift): string {
  const lines: string[] = []
  if (drift.declaredButNotRegistered.length > 0) {
    lines.push(
      `manifest declares tools that register() did not register: ${drift.declaredButNotRegistered.join(', ')}`
    )
  }
  if (drift.registeredButNotDeclared.length > 0) {
    lines.push(
      `register() registered tools missing from manifest provides.tools[]: ${drift.registeredButNotDeclared.join(', ')}`
    )
  }
  return `${extensionId}: ${lines.join('; ')}`
}

/**
 * Diff the manifest vs runtime catalog and throw on drift. The loader
 * catches the throw, unregisters the partially-loaded extension, and
 * surfaces the error to the user via the status bar.
 *
 * Returns the (empty) drift report on success for callers that want
 * post-load introspection.
 */
export function reconcileToolCatalog(
  extensionId: string,
  manifest: ExtensionManifest,
  registered: ExtensionToolEntry[]
): ToolCatalogDrift {
  const drift = diffToolCatalog(manifest, registered)
  if (drift.declaredButNotRegistered.length > 0 || drift.registeredButNotDeclared.length > 0) {
    throw new ToolCatalogDriftError(extensionId, drift)
  }
  return drift
}
