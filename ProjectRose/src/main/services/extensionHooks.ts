import type {
  ChatHook,
  ChatHookManifestEntry,
  HookType,
  HookInjectionPolicy,
  ThoughtHookEvent,
  MessageHookEvent,
  ToolCallHookEvent,
  UserMessageHookEvent,
  TokenHookEvent,
  InjectionRecord
} from '../../shared/extensionHooks'
import {
  MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE,
  DEFAULT_HOOK_PRIORITY,
  DEFAULT_INJECTION_POLICY
} from '../../shared/extensionHooks'

interface RegisteredHooks {
  extensionId: string
  extensionName: string
  extensionIcon?: string
  rootPath: string
  hooks: ChatHook[]
  /** Per-hook-type policy declared on the manifest. */
  policies: Map<HookType, HookInjectionPolicy>
  /**
   * Order in which `registerHooks` was called for this extension, used as a
   * tiebreak when two registrations declare the same priority. Monotonic
   * across the pipeline's lifetime.
   */
  registrationSeq: number
}

interface DispatchEntry {
  reg: RegisteredHooks
  hook: ChatHook
  /** Effective priority: explicit `hook.priority` ?? DEFAULT_HOOK_PRIORITY. */
  priority: number
}

/**
 * Owns the registered-hooks list, the per-extension turn budget, and the
 * dispatch logic for chat hooks.
 *
 * Replaces the previous bare `Map<string, RegisteredHooks>` + module-level
 * `turnBudget` Map. Ordering and injection policy are now first-class
 * concepts surfaced on the contract:
 *
 *   - `priority?: number` on `ChatHook` (lower fires first, default 100).
 *   - `injectionPolicy: 'first-wins' | 'all'` declared per hook type in
 *     `manifest.provides.hooks[]`. If omitted, defaults to `'first-wins'`.
 *   - Registration order is the documented tiebreak when priorities match.
 *
 * The host instantiates a single pipeline; the module-level functions below
 * are thin wrappers around that singleton so existing call sites keep
 * working unchanged.
 */
export class HookPipeline {
  private readonly registry = new Map<string, RegisteredHooks>()
  /** Per-extension injection counter for the current user turn. */
  private readonly turnBudget = new Map<string, number>()
  private nextRegistrationSeq = 0

  register(
    key: string,
    info: {
      extensionId: string
      extensionName: string
      extensionIcon?: string
      rootPath: string
    },
    hooks: ChatHook[],
    manifestHooks?: ChatHookManifestEntry[]
  ): void {
    const policies = new Map<HookType, HookInjectionPolicy>()
    if (manifestHooks) {
      for (const entry of manifestHooks) {
        policies.set(entry.type, entry.injectionPolicy ?? DEFAULT_INJECTION_POLICY)
      }
    }
    this.registry.set(key, {
      ...info,
      hooks,
      policies,
      registrationSeq: this.nextRegistrationSeq++
    })
  }

  unregister(key: string): void {
    this.registry.delete(key)
  }

  resetTurnBudgets(): void {
    this.turnBudget.clear()
  }

  /**
   * Returns the list of hook types this extension's manifest declared but
   * which were not actually registered at runtime. Used by the loader to
   * warn about drift after `register(ctx)` returns.
   */
  declaredButNotRegistered(key: string, declared: HookType[]): HookType[] {
    const reg = this.registry.get(key)
    if (!reg) return [...declared]
    const registeredTypes = new Set<HookType>(reg.hooks.map((h) => h.type))
    return declared.filter((t) => !registeredTypes.has(t))
  }

  /**
   * Returns the list of hook types registered at runtime but not declared
   * on the manifest. Used by the loader to warn about drift.
   */
  registeredButNotDeclared(key: string, declared: HookType[]): HookType[] {
    const reg = this.registry.get(key)
    if (!reg) return []
    const declaredSet = new Set(declared)
    const seen = new Set<HookType>()
    const drift: HookType[] = []
    for (const h of reg.hooks) {
      if (seen.has(h.type)) continue
      seen.add(h.type)
      if (!declaredSet.has(h.type)) drift.push(h.type)
    }
    return drift
  }

  // --- Dispatch -----------------------------------------------------------

  /**
   * Collect every matching hook for the given type, in firing order
   * (priority ascending, registration order as tiebreak), filtered to the
   * given rootPath.
   */
  private collectMatching(
    type: HookType,
    rootPath: string
  ): DispatchEntry[] {
    const entries: DispatchEntry[] = []
    for (const reg of this.registry.values()) {
      if (reg.rootPath !== rootPath) continue
      for (const hook of reg.hooks) {
        if (hook.type !== type) continue
        entries.push({
          reg,
          hook,
          priority: hook.priority ?? DEFAULT_HOOK_PRIORITY
        })
      }
    }
    entries.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      // Same priority → registration order. `Map` iteration above already
      // visited extensions in registration order, but the same extension
      // may have multiple hooks of the same type; keep their array order.
      return a.reg.registrationSeq - b.reg.registrationSeq
    })
    return entries
  }

  /** Policy for a hook type for a given registered extension. */
  private policyFor(reg: RegisteredHooks, type: HookType): HookInjectionPolicy {
    return reg.policies.get(type) ?? DEFAULT_INJECTION_POLICY
  }

  private budgetCap(matching: ChatHook[]): number {
    return matching.some((h) => h.allowMultiple)
      ? MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE
      : 1
  }

  async fireInjecting(
    type: 'on_thought' | 'on_message',
    event: ThoughtHookEvent | MessageHookEvent,
    rootPath: string
  ): Promise<InjectionRecord | null> {
    const entries = this.collectMatching(type, rootPath)
    if (entries.length === 0) return null

    // Group entries by extension so per-extension budgets are coherent.
    // Iteration order of `Map` preserves insertion order, which mirrors
    // the sorted `entries` order — first appearance of each extension key
    // determines its dispatch slot.
    const byExtension = new Map<string, DispatchEntry[]>()
    for (const e of entries) {
      const key = `${e.reg.rootPath}/${e.reg.extensionId}`
      const list = byExtension.get(key)
      if (list) list.push(e)
      else byExtension.set(key, [e])
    }

    // Dispatch order: priority-sorted extensions (priority asc, registration
    // order tiebreak). Per-extension policy controls behaviour:
    //
    //   - `first-wins` (the default and today's behaviour): the extension's
    //     hooks run in registration order until one injects, then dispatch
    //     STOPS GLOBALLY — no more hooks of this type fire this event,
    //     across any extension.
    //
    //   - `all`: the extension's hooks all run, and each may inject (up to
    //     the extension's per-turn budget). After the extension is done,
    //     dispatch CONTINUES to the next extension. An `all` extension
    //     never stops the global pipeline.
    //
    // Mixed-policy case: if an earlier extension with `first-wins` already
    // injected, the dispatch is over — even if later extensions declared
    // `all`. This matches the "first injection wins" guarantee from the
    // pre-pipeline code path.
    const collected: InjectionRecord[] = []
    let globalStop = false

    for (const [, group] of byExtension) {
      if (globalStop) break

      const reg = group[0].reg
      const policy = this.policyFor(reg, type)

      const used = this.turnBudget.get(reg.extensionId) ?? 0
      const cap = this.budgetCap(group.map((g) => g.hook))
      if (used >= cap) continue

      let extensionInjected = false
      for (const entry of group) {
        const remaining = cap - (this.turnBudget.get(reg.extensionId) ?? 0)
        if (remaining <= 0) break

        let result: unknown
        try {
          result = await entry.hook.handler(event)
        } catch (err) {
          console.error(
            `[rose-ext] hook ${reg.extensionId} ${type} threw:`,
            err
          )
          continue
        }

        if (
          result &&
          typeof result === 'object' &&
          'inject' in result &&
          typeof (result as { inject?: unknown }).inject === 'string' &&
          (result as { inject: string }).inject.length > 0
        ) {
          this.turnBudget.set(
            reg.extensionId,
            (this.turnBudget.get(reg.extensionId) ?? 0) + 1
          )
          collected.push({
            extensionId: reg.extensionId,
            extensionName: reg.extensionName,
            extensionIcon: reg.extensionIcon,
            content: (result as { inject: string }).inject
          })
          extensionInjected = true
          if (policy === 'first-wins') break
        }
      }

      if (extensionInjected && policy === 'first-wins') {
        globalStop = true
      }
    }

    if (collected.length === 0) return null

    // Merge all collected injections into a single InjectionRecord. The
    // caller's existing single-record return shape stays back-compat for
    // `first-wins` (which only ever collects one). For `'all'`, multiple
    // injections get concatenated with double-newline separators; the
    // record's extensionId/Name/Icon describe the FIRST injecting
    // extension, since that's the strongest signal of provenance in the
    // current UI.
    if (collected.length === 1) return collected[0]
    return {
      extensionId: collected[0].extensionId,
      extensionName: collected[0].extensionName,
      extensionIcon: collected[0].extensionIcon,
      content: collected.map((c) => c.content).join('\n\n')
    }
  }

  /** Notifying-only dispatch — runs every matching hook, ignores return. */
  private async fireNotifying<E extends { type: HookType }>(
    type: HookType,
    event: E,
    rootPath: string
  ): Promise<void> {
    const entries = this.collectMatching(type, rootPath)
    for (const entry of entries) {
      try {
        await entry.hook.handler(event as never)
      } catch (err) {
        console.error(
          `[rose-ext] hook ${entry.reg.extensionId} ${type} threw:`,
          err
        )
      }
    }
  }

  fireThought(content: string, turnId: string, rootPath: string): Promise<InjectionRecord | null> {
    const event: ThoughtHookEvent = { type: 'on_thought', content, turnId }
    return this.fireInjecting('on_thought', event, rootPath)
  }

  fireMessage(content: string, turnId: string, rootPath: string): Promise<InjectionRecord | null> {
    const event: MessageHookEvent = { type: 'on_message', content, turnId }
    return this.fireInjecting('on_message', event, rootPath)
  }

  fireUserMessage(content: string, rootPath: string): Promise<void> {
    const event: UserMessageHookEvent = { type: 'on_user_message', content }
    return this.fireNotifying('on_user_message', event, rootPath)
  }

  fireToken(token: string, turnId: string, rootPath: string): Promise<void> {
    const event: TokenHookEvent = { type: 'on_token', token, turnId }
    return this.fireNotifying('on_token', event, rootPath)
  }

  fireToolCall(
    payload: { toolName: string; params: Record<string, unknown>; result: string; error: boolean; turnId: string },
    rootPath: string
  ): Promise<void> {
    const event: ToolCallHookEvent = { type: 'on_tool_call', ...payload }
    return this.fireNotifying('on_tool_call', event, rootPath)
  }
}

// --- Singleton + thin wrappers ---------------------------------------------
// Existing call sites use the module-level functions below. Keep them as a
// stable seam; everything inside delegates to `hookPipeline`.

export const hookPipeline = new HookPipeline()

export function registerHooks(
  key: string,
  info: { extensionId: string; extensionName: string; extensionIcon?: string; rootPath: string },
  hooks: ChatHook[],
  manifestHooks?: ChatHookManifestEntry[]
): void {
  hookPipeline.register(key, info, hooks, manifestHooks)
}

export function unregisterHooks(key: string): void {
  hookPipeline.unregister(key)
}

export function resetTurnBudgets(): void {
  hookPipeline.resetTurnBudgets()
}

export function fireThoughtHook(
  content: string,
  turnId: string,
  rootPath: string
): Promise<InjectionRecord | null> {
  return hookPipeline.fireThought(content, turnId, rootPath)
}

export function fireMessageHook(
  content: string,
  turnId: string,
  rootPath: string
): Promise<InjectionRecord | null> {
  return hookPipeline.fireMessage(content, turnId, rootPath)
}

export function fireUserMessageHook(content: string, rootPath: string): Promise<void> {
  return hookPipeline.fireUserMessage(content, rootPath)
}

export function fireTokenHook(token: string, turnId: string, rootPath: string): Promise<void> {
  return hookPipeline.fireToken(token, turnId, rootPath)
}

export function fireToolCallHook(
  payload: { toolName: string; params: Record<string, unknown>; result: string; error: boolean; turnId: string },
  rootPath: string
): Promise<void> {
  return hookPipeline.fireToolCall(payload, rootPath)
}

export type { HookType }
