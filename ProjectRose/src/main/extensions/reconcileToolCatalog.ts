// Tool-catalog reconciliation.
//
// The manifest's `provides.tools[]` is display metadata that drives the
// Settings -> Tools UI and the `disabledTools` machinery. The runtime
// `ctx.registerTools(...)` registers the actual `execute` functions. They
// share a `name` by convention only — there is nothing today that says the
// two have to agree. When they drift:
//
//   - A tool declared in the manifest but never registered: the Settings UI
//     shows a row the agent will never see. `defaultDisabled` rules still
//     apply, so the tool gets added to `disabledTools` for nothing.
//
//   - A tool registered at runtime but absent from the manifest: the
//     Settings UI silently hides it; the agent CAN see it, so it's a
//     stealth tool the user can't toggle.
//
// This module emits a clear warning for either side of the drift at load
// time. It does not yet refuse the load — the PRD's "one tool shape" goal
// flips that to enforcement in the cleanup slice (#37) once every
// first-party manifest is clean.

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

/**
 * Diff the manifest vs runtime catalog and emit `console.warn` lines for
 * each side of any drift. Returns the drift report for callers that want to
 * surface it elsewhere (e.g. a status-bar toast, an extension health view).
 */
export function reconcileToolCatalog(
  extensionId: string,
  manifest: ExtensionManifest,
  registered: ExtensionToolEntry[]
): ToolCatalogDrift {
  const drift = diffToolCatalog(manifest, registered)
  if (drift.declaredButNotRegistered.length > 0) {
    console.warn(
      `[rose-ext] ${extensionId}: manifest declares tools that register() did not register: ${drift.declaredButNotRegistered.join(', ')}`
    )
  }
  if (drift.registeredButNotDeclared.length > 0) {
    console.warn(
      `[rose-ext] ${extensionId}: register() registered tools missing from manifest provides.tools[]: ${drift.registeredButNotDeclared.join(', ')}`
    )
  }
  return drift
}
