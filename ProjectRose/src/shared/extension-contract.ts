// Single import surface for extension authors.
//
// This module is the public contract between the host (ProjectRose) and
// extensions. Everything an extension is allowed to depend on is re-exported
// from here; anything not exported from this file is by definition NOT part
// of the contract and may move or change without notice.
//
// Extensions should import only from '@shared/extension-contract' (or the
// equivalent alias the extension's bundler resolves to this file).

// --- Manifest and installation ---------------------------------------------
export type {
  ExtensionManifest,
  InstalledExtension,
  ExtensionToolEntry,
  ExtensionToolCtx,
  ExtensionToolParameter,
  ExtensionToolDefinition
} from './extension-types'

// --- Chat hooks ------------------------------------------------------------
export type {
  ChatHook,
  ChatHookManifestEntry,
  HookType,
  HookEvent,
  HookInjectionPolicy,
  ThoughtHookEvent,
  MessageHookEvent,
  TokenHookEvent,
  ToolCallHookEvent,
  UserMessageHookEvent,
  HookResult,
  InjectionRecord
} from './extensionHooks'

export {
  MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE,
  DEFAULT_HOOK_PRIORITY,
  DEFAULT_INJECTION_POLICY
} from './extensionHooks'

// --- Manifest validator (host enforces this at install + load time) -------
export type {
  Capability,
  ManifestValidationIssue,
  ValidateManifestResult
} from './extension-manifest-validator'
export {
  CAPABILITY_KEYS,
  validateManifest,
  formatManifestIssues
} from './extension-manifest-validator'

// --- Agent session ---------------------------------------------------------
// Note: this re-exports only the type. The session implementation lives in
// the host (`src/main/services/agentSession.ts`) and is constructed by the
// host when an extension calls `ctx.openAgentSession(...)`.
export type { AgentSession } from './extension-agent-session'

// --- Main-process context handed to extensions on register() ---------------
import type {
  ExtensionToolEntry,
  ExtensionToolCtx as _ExtensionToolCtx
} from './extension-types'
import type { ChatHook } from './extensionHooks'
import type { AgentSession } from './extension-agent-session'

// Suppress unused import warning — kept for documentation that ToolCtx is
// part of this contract.
type _ToolCtxAlias = _ExtensionToolCtx

/**
 * Context object passed to an extension's `register(ctx)` entry point.
 *
 * The host constructs one of these per loaded extension. Extensions should
 * treat it as the only legal channel for talking to the host.
 */
export interface ExtensionMainContext {
  /** Absolute path to the currently-open project root. */
  rootPath: string

  /** Read the host's merged settings object (sensitive fields are inlined). */
  getSettings: () => Promise<Record<string, unknown>>

  /** Merge a patch into the host's settings. */
  updateSettings: (patch: Record<string, unknown>) => Promise<void>

  /** Send a message to all renderer windows on the given IPC channel. */
  broadcast: (channel: string, data: unknown) => void

  /** Surface a transient message in the renderer's bottom status bar. */
  notifyStatus: (
    text: string,
    opts?: { tone?: 'info' | 'success' | 'error' | 'warning'; durationMs?: number }
  ) => void

  /** Register the runtime tools this extension provides. */
  registerTools: (tools: ExtensionToolEntry[]) => void

  /**
   * Mark settings keys as sensitive so they're stored in userData/settings.json
   * instead of the project repo config (where they could be committed).
   */
  registerSensitiveFields: (keys: string[]) => void

  /**
   * Run a one-shot background agent turn with the supplied prompt and system
   * prompt. The host returns the assistant's final text content. Hooks do
   * NOT fire during background-agent runs.
   */
  runBackgroundAgent: (prompt: string, systemPrompt: string) => Promise<string>

  /**
   * Register chat hooks. Hooks fire only for the user-visible main chat;
   * they do NOT fire inside runBackgroundAgent or openAgentSession.send.
   */
  registerHooks: (hooks: ChatHook[]) => void

  /**
   * Open a multi-turn agent session. Each session keeps its own message
   * history; subsequent send() calls reuse it. Hooks do not fire during
   * these calls.
   */
  openAgentSession: (opts: { systemPrompt: string }) => AgentSession
}
