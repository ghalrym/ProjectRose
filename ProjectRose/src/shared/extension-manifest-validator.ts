// Manifest validator for the extension contract.
//
// This is the single source of truth for what a `rose-extension.json` is
// allowed to contain. The host runs `validateManifest` at install time and
// again every time an extension's main module loads, so a malformed manifest
// fails fast instead of half-loading.
//
// Validation strictness (HITL-resolved):
//   - Required fields missing or wrong type        -> error
//   - Known fields with malformed values           -> error
//   - Unknown keys inside `provides`               -> warning (forward-compat:
//     a newer extension may declare a capability an older host doesn't yet
//     know about; the host should keep loading and ignore the unknown key)
//   - Unknown keys outside `provides` (top-level)  -> ignored silently; the
//     manifest schema is intentionally open at the top level so authors can
//     add metadata fields (engines, repository, etc.) without us breaking.
//
// This file deliberately has NO runtime dependencies beyond TypeScript types.
// It is consumed from both the host (main process) and tests, and may
// eventually be re-exported to extension bundles unchanged.

import type { ExtensionManifest } from './extension-types'

/** Every capability key the host recognises. */
export const CAPABILITY_KEYS = [
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
] as const

export type Capability = (typeof CAPABILITY_KEYS)[number]

/** Keys that live in `provides` but are not capability booleans. */
const PROVIDES_NON_CAPABILITY_KEYS = new Set<string>(['tools', 'systemPrompt', 'hooks'])

/** Hook types the host recognises. Kept in sync with `HookType` in extensionHooks.ts. */
const HOOK_TYPES = new Set<string>([
  'on_thought',
  'on_message',
  'on_tool_call',
  'on_user_message',
  'on_token'
])

const INJECTION_POLICIES = new Set<string>(['first-wins', 'all'])

export interface ManifestValidationIssue {
  /** Dotted path to the offending field, e.g. `provides.tools[0].name`. */
  path: string
  message: string
}

export type ValidateManifestResult =
  | { ok: true; manifest: ExtensionManifest; warnings: ManifestValidationIssue[] }
  | { ok: false; errors: ManifestValidationIssue[]; warnings: ManifestValidationIssue[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * Parse and validate a raw manifest object.
 *
 * On success the returned `manifest` is the same `raw` object cast to
 * `ExtensionManifest` — no normalisation or defaulting is performed; the
 * shape just matches the type. Unknown capability keys are reported in
 * `warnings` but left on the object as-is so a host upgrade later can use them.
 */
export function validateManifest(raw: unknown): ValidateManifestResult {
  const errors: ManifestValidationIssue[] = []
  const warnings: ManifestValidationIssue[] = []

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'manifest must be a JSON object' }],
      warnings
    }
  }

  // --- Required string fields ----------------------------------------------
  for (const field of ['id', 'name', 'version', 'description', 'author'] as const) {
    if (!(field in raw)) {
      errors.push({ path: field, message: `missing required field "${field}"` })
    } else if (!isNonEmptyString(raw[field])) {
      errors.push({ path: field, message: `field "${field}" must be a non-empty string` })
    }
  }

  // --- Optional string fields ----------------------------------------------
  for (const field of ['latin', 'icon'] as const) {
    if (field in raw && raw[field] !== undefined && typeof raw[field] !== 'string') {
      errors.push({ path: field, message: `field "${field}" must be a string when present` })
    }
  }

  // --- navItem -------------------------------------------------------------
  if ('navItem' in raw && raw.navItem !== undefined) {
    const nav = raw.navItem
    if (!isRecord(nav)) {
      errors.push({ path: 'navItem', message: 'navItem must be an object' })
    } else {
      if (!isNonEmptyString(nav.label)) {
        errors.push({ path: 'navItem.label', message: 'navItem.label must be a non-empty string' })
      }
      if (!isNonEmptyString(nav.iconName)) {
        errors.push({ path: 'navItem.iconName', message: 'navItem.iconName must be a non-empty string' })
      }
    }
  }

  // --- provides ------------------------------------------------------------
  if (!('provides' in raw)) {
    errors.push({ path: 'provides', message: 'missing required field "provides"' })
  } else if (!isRecord(raw.provides)) {
    errors.push({ path: 'provides', message: 'provides must be an object' })
  } else {
    const provides = raw.provides
    const knownCapabilities = new Set<string>(CAPABILITY_KEYS)

    for (const [key, value] of Object.entries(provides)) {
      if (knownCapabilities.has(key)) {
        if (typeof value !== 'boolean') {
          errors.push({
            path: `provides.${key}`,
            message: `capability "${key}" must be a boolean`
          })
        }
      } else if (key === 'tools') {
        validateTools(value, errors)
      } else if (key === 'hooks') {
        validateHooks(value, errors)
      } else if (key === 'systemPrompt') {
        if (typeof value !== 'string' || value.length === 0) {
          errors.push({
            path: 'provides.systemPrompt',
            message: 'provides.systemPrompt must be a non-empty string (relative path to a markdown file)'
          })
        }
      } else if (!PROVIDES_NON_CAPABILITY_KEYS.has(key)) {
        warnings.push({
          path: `provides.${key}`,
          message: `unknown capability key "${key}" — ignoring (may be from a newer host)`
        })
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings }
  return { ok: true, manifest: raw as unknown as ExtensionManifest, warnings }
}

function validateTools(value: unknown, errors: ManifestValidationIssue[]): void {
  if (!Array.isArray(value)) {
    errors.push({ path: 'provides.tools', message: 'provides.tools must be an array' })
    return
  }
  const seen = new Set<string>()
  value.forEach((entry, i) => {
    const p = `provides.tools[${i}]`
    if (!isRecord(entry)) {
      errors.push({ path: p, message: 'tool entry must be an object' })
      return
    }
    if (!isNonEmptyString(entry.name)) {
      errors.push({ path: `${p}.name`, message: 'tool.name must be a non-empty string' })
    } else if (seen.has(entry.name)) {
      errors.push({ path: `${p}.name`, message: `duplicate tool name "${entry.name}"` })
    } else {
      seen.add(entry.name)
    }
    if (!isNonEmptyString(entry.displayName)) {
      errors.push({ path: `${p}.displayName`, message: 'tool.displayName must be a non-empty string' })
    }
    if (!isNonEmptyString(entry.description)) {
      errors.push({ path: `${p}.description`, message: 'tool.description must be a non-empty string' })
    }
    if (
      'defaultDisabled' in entry &&
      entry.defaultDisabled !== undefined &&
      typeof entry.defaultDisabled !== 'boolean'
    ) {
      errors.push({
        path: `${p}.defaultDisabled`,
        message: 'tool.defaultDisabled must be a boolean when present'
      })
    }
  })
}

function validateHooks(value: unknown, errors: ManifestValidationIssue[]): void {
  if (!Array.isArray(value)) {
    errors.push({ path: 'provides.hooks', message: 'provides.hooks must be an array' })
    return
  }
  const seen = new Set<string>()
  value.forEach((entry, i) => {
    const p = `provides.hooks[${i}]`
    if (!isRecord(entry)) {
      errors.push({ path: p, message: 'hook entry must be an object' })
      return
    }
    if (!isNonEmptyString(entry.type)) {
      errors.push({ path: `${p}.type`, message: 'hook.type must be a non-empty string' })
    } else if (!HOOK_TYPES.has(entry.type)) {
      errors.push({
        path: `${p}.type`,
        message: `hook.type "${entry.type}" is not a known hook type`
      })
    } else if (seen.has(entry.type)) {
      errors.push({
        path: `${p}.type`,
        message: `duplicate hook declaration for type "${entry.type}"`
      })
    } else {
      seen.add(entry.type)
    }
    if (
      'injectionPolicy' in entry &&
      entry.injectionPolicy !== undefined &&
      (typeof entry.injectionPolicy !== 'string' || !INJECTION_POLICIES.has(entry.injectionPolicy))
    ) {
      errors.push({
        path: `${p}.injectionPolicy`,
        message: 'hook.injectionPolicy must be "first-wins" or "all" when present'
      })
    }
    if (
      'priority' in entry &&
      entry.priority !== undefined &&
      (typeof entry.priority !== 'number' || !Number.isFinite(entry.priority))
    ) {
      errors.push({
        path: `${p}.priority`,
        message: 'hook.priority must be a finite number when present'
      })
    }
  })
}

/** Format a list of issues as a single human-readable string. */
export function formatManifestIssues(issues: ManifestValidationIssue[]): string {
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')
}
