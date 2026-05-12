export type HookType = 'on_thought' | 'on_message' | 'on_tool_call' | 'on_user_message' | 'on_token'

export interface ThoughtHookEvent {
  type: 'on_thought'
  content: string
  turnId: string
}

export interface MessageHookEvent {
  type: 'on_message'
  content: string
  turnId: string
}

// Fires for each text-delta chunk emitted by the model. Notification-only —
// no injection. Handlers should return quickly; the firing site does not await
// them, so a slow handler will not stall token streaming.
export interface TokenHookEvent {
  type: 'on_token'
  token: string
  turnId: string
}

export interface ToolCallHookEvent {
  type: 'on_tool_call'
  toolName: string
  params: Record<string, unknown>
  result: string
  error: boolean
  turnId: string
}

// Fires once per user-initiated turn, before any model output. Auto-injection
// iterations do NOT re-fire this — only fresh user messages do. Notification
// only; injections are not collected from this hook.
export interface UserMessageHookEvent {
  type: 'on_user_message'
  content: string
}

export type HookEvent = ThoughtHookEvent | MessageHookEvent | ToolCallHookEvent | UserMessageHookEvent | TokenHookEvent

export interface HookResult {
  inject?: string
}

export interface ChatHook {
  type: HookType
  handler: (event: HookEvent) => Promise<HookResult | void> | HookResult | void
  allowMultiple?: boolean
  /**
   * Optional firing order. Lower priority fires first. Hooks default to `100`.
   * Hooks with equal priority fire in registration order (the host preserves
   * the order each extension's `registerHooks(...)` call established, and
   * extensions register in the host's load order).
   */
  priority?: number
}

/**
 * Per-hook-type injection policy declared on the manifest.
 *
 * - `'first-wins'` — the first hook that returns `{ inject: '...' }` for a
 *   given event ends the dispatch. This is the historical behaviour and the
 *   default for hooks that don't declare a policy.
 * - `'all'` — every matching hook is allowed to inject, up to each
 *   extension's per-turn budget (`MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE`
 *   when `allowMultiple: true`, else 1). The host concatenates the injection
 *   strings with double-newline separators.
 */
export type HookInjectionPolicy = 'first-wins' | 'all'

/**
 * Manifest declaration of a chat hook the extension provides. Lives at
 * `manifest.provides.hooks[]`. Optional — extensions that omit the
 * declaration get today's defaults (`first-wins`, priority `100`).
 */
export interface ChatHookManifestEntry {
  type: HookType
  injectionPolicy?: HookInjectionPolicy
  priority?: number
}

export interface InjectionRecord {
  extensionId: string
  extensionName: string
  extensionIcon?: string
  content: string
}

export const MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE = 5

/** Default firing-order priority for hooks that don't declare one. */
export const DEFAULT_HOOK_PRIORITY = 100

/** Default injection policy for hook types not listed in `provides.hooks[]`. */
export const DEFAULT_INJECTION_POLICY: HookInjectionPolicy = 'first-wins'
