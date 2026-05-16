// Process-wide tool registry.
//
// Before this module existed, "the set of tools available to the agent this
// turn" was assembled inline at every chat-loop entry (`streamChat`,
// `runAgentOnce`) by calling `buildCoreTools`, `buildExtensionTools`,
// `buildSubagentTools`, `buildSkillTools` in the right order with the right
// filters. Adding a new tool category or a new entry point meant editing
// every call site.
//
// The registry is a single owner: sources register **into** it once at
// startup (or extension load), and callers ask `getToolsForSession(...)`
// for the finalised tool set. `disabledTools` is applied here, exactly once.
//
// This slice owns the `core` and `extension` sources. Subagent and skill
// tools are still merged inline by the caller; they move in later issues
// (#15).
//
// See PRD #12 for the broader design.

import { tool } from 'ai'
import type { ToolExecutionOptions } from 'ai'
import { z } from 'zod'
import type { ExtensionManifest, ExtensionToolCtx, ExtensionToolEntry } from '../../shared/extension-types'
import { IPC } from '../../shared/ipcChannels'
import { fireToolCallHook } from './extensionHooks'
import { reconcileToolCatalog, type ToolCatalogDrift } from '../extensions/reconcileToolCatalog'
// Type-only imports keep the registry's runtime dependency graph one-way
// (llmClient/subagentTools/skillService import the registry; the registry
// imports their types but not their runtime modules).
import type { AgentContext, SubagentCounter } from './agentRunner'
import type { ModelConfig } from './settingsService'
import type { ProviderKeys } from './llmClient'

export type EmitFn = (channel: string, payload: unknown) => void

export interface HookCtx {
  turnId: string
  rootPath: string
}

export type ToolSourceName = 'core' | 'subagent' | 'skill' | 'extension'

// The tools produced by `ai.tool({ ... })` are heterogeneous and the SDK's
// `Tool` type is generic over its input schema. The registry treats them as
// opaque values keyed by name and lets the caller hand them to `streamText`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolMap = Record<string, any>

export interface ToolSourceContext {
  rootPath: string
  emit: EmitFn
  toolCtx: ExtensionToolCtx
  hookCtx?: HookCtx
}

export type BuildCoreToolsFn = (ctx: ToolSourceContext) => ToolMap

// Per-turn context the subagent factory needs. Lives on the registry because
// it's the public shape of `getToolsForSession({ subagent: ... })`.
export interface SubagentTurnContext {
  agentCtx: AgentContext
  model: ModelConfig
  providerKeys: ProviderKeys
  ollamaBaseUrl: string
  openaiCompatBaseUrl: string
  counter: SubagentCounter
  systemPrompt: string
}

export type BuildSubagentToolsFn = (ctx: ToolSourceContext, turn: SubagentTurnContext) => ToolMap
export type BuildSkillToolsFn = (ctx: ToolSourceContext) => ToolMap

export interface GetToolsOpts extends ToolSourceContext {
  disabledTools?: string[]
  enabledExtensionIds?: string[]
  include?: readonly ToolSourceName[]
  subagent?: SubagentTurnContext
}

const ALL_SOURCES: readonly ToolSourceName[] = ['core', 'subagent', 'skill', 'extension'] as const

type ExecuteFn = (input: Record<string, unknown>, projectRoot: string, toolCtx: ExtensionToolCtx) => Promise<string>

/**
 * Standard `execute` wrapper for tools. Emits per-call IPC events, captures
 * errors, and fires the post-tool-call hook when a hook context is present.
 * Used by both the core source and the extension source so they emit the
 * same lifecycle events to the renderer.
 */
export function wrapExecute(
  name: string,
  fn: ExecuteFn,
  projectRoot: string,
  emit: EmitFn,
  toolCtx: ExtensionToolCtx,
  hookCtx?: HookCtx
): (input: Record<string, unknown>, options: ToolExecutionOptions) => Promise<string> {
  return async (input, options) => {
    const id = options.toolCallId
    const sessionId = toolCtx.sessionId
    emit(IPC.AI_TOOL_CALL_START, { sessionId, id, name, params: input })
    let result: string
    let error = false
    try {
      result = await fn(input, projectRoot, toolCtx)
      emit(IPC.AI_TOOL_CALL_END, { sessionId, id, result, error: false })
    } catch (err) {
      result = err instanceof Error ? err.message : String(err)
      error = true
      emit(IPC.AI_TOOL_CALL_END, { sessionId, id, result, error: true })
    }
    if (hookCtx) {
      await fireToolCallHook(
        { toolName: name, params: input, result, error, turnId: hookCtx.turnId },
        hookCtx.rootPath
      )
    }
    return result
  }
}

function buildExtensionTools(entries: ExtensionToolEntry[], ctx: ToolSourceContext): ToolMap {
  const result: ToolMap = {}
  for (const entry of entries) {
    const shape: Record<string, z.ZodTypeAny> = {}
    const props = entry.schema?.properties ?? {}
    for (const [key, def] of Object.entries(props as Record<string, { type: string; description?: string; enum?: string[] }>)) {
      let zodType: z.ZodTypeAny
      if (def.enum) {
        zodType = z.enum(def.enum as [string, ...string[]])
      } else if (def.type === 'number') {
        zodType = z.number()
      } else {
        zodType = z.string()
      }
      const required = (entry.schema?.required as string[] | undefined)?.includes(key) ?? false
      shape[key] = required
        ? zodType.describe(def.description ?? '')
        : zodType.optional().describe(def.description ?? '')
    }
    result[entry.name] = tool({
      description: entry.description,
      inputSchema: z.object(shape),
      execute: wrapExecute(entry.name, entry.execute, ctx.rootPath, ctx.emit, ctx.toolCtx, ctx.hookCtx)
    })
  }
  return result
}

export class ToolRegistry {
  private buildCoreToolsFn: BuildCoreToolsFn | null = null
  private buildSubagentToolsFn: BuildSubagentToolsFn | null = null
  private buildSkillToolsFn: BuildSkillToolsFn | null = null
  private coreToolNames: string[] = []
  // Keyed by `${rootPath}/${extensionId}` — mirrors the prior storage in
  // `extensionHandlers.ts` so per-project extensions don't collide.
  private extensionTools = new Map<string, ExtensionToolEntry[]>()

  registerCoreTools(buildFn: BuildCoreToolsFn): void {
    this.buildCoreToolsFn = buildFn
    // Probe the builder once with a stub context to capture the names. The
    // `ai.tool({...})` factory only stores references at construction time —
    // execute functions don't fire until the agent invokes them — so the
    // probe is side-effect-free. Cached so consumers (Settings -> Tools
    // catalog, manifest reconciliation) can list core names without rebuilding.
    const probe = buildFn({
      rootPath: '',
      emit: () => {},
      toolCtx: { sessionId: '', turnId: undefined }
    })
    this.coreToolNames = Object.keys(probe)
  }

  /** Names of the registered core tools, in source-declaration order. */
  getCoreToolNames(): readonly string[] {
    return this.coreToolNames
  }

  registerSubagentSource(buildFn: BuildSubagentToolsFn): void {
    this.buildSubagentToolsFn = buildFn
  }

  registerSkillSource(buildFn: BuildSkillToolsFn): void {
    this.buildSkillToolsFn = buildFn
  }

  registerExtensionTools(extensionId: string, rootPath: string, tools: ExtensionToolEntry[]): void {
    this.extensionTools.set(`${rootPath}/${extensionId}`, tools)
  }

  unregisterExtension(extensionId: string, rootPath: string): void {
    this.extensionTools.delete(`${rootPath}/${extensionId}`)
  }

  /** Raw entries for one extension; used by manifest reconciliation. */
  getExtensionToolEntries(extensionId: string, rootPath: string): ExtensionToolEntry[] {
    return this.extensionTools.get(`${rootPath}/${extensionId}`) ?? []
  }

  /**
   * Diff the manifest's declared `provides.tools[].name` against the tools
   * `register()` actually wired into the registry. Throws on drift — the
   * extension loader catches the throw and refuses to retain the extension
   * (#37 flipped this from warning-only to enforcement).
   *
   * This is the registry-owned entry point the loader uses; the underlying
   * `reconcileToolCatalog` helper continues to provide the pure diff for
   * unit tests.
   */
  assertManifestMatches(extensionId: string, rootPath: string, manifest: ExtensionManifest): ToolCatalogDrift {
    return reconcileToolCatalog(extensionId, manifest, this.getExtensionToolEntries(extensionId, rootPath))
  }

  /** Raw entries for a set of enabled extensions; used by Settings UI. */
  getEnabledExtensionToolEntries(rootPath: string, enabledIds: string[]): ExtensionToolEntry[] {
    return enabledIds.flatMap((id) => this.extensionTools.get(`${rootPath}/${id}`) ?? [])
  }

  getToolsForSession(opts: GetToolsOpts): ToolMap {
    const include = opts.include ?? ALL_SOURCES
    const sourceCtx: ToolSourceContext = {
      rootPath: opts.rootPath,
      emit: opts.emit,
      toolCtx: opts.toolCtx,
      hookCtx: opts.hookCtx
    }
    const tools: ToolMap = {}

    if (include.includes('core') && this.buildCoreToolsFn) {
      Object.assign(tools, this.buildCoreToolsFn(sourceCtx))
    }

    if (include.includes('extension') && opts.enabledExtensionIds && opts.enabledExtensionIds.length > 0) {
      const entries = this.getEnabledExtensionToolEntries(opts.rootPath, opts.enabledExtensionIds)
      Object.assign(tools, buildExtensionTools(entries, sourceCtx))
    }

    if (include.includes('subagent') && this.buildSubagentToolsFn && opts.subagent) {
      Object.assign(tools, this.buildSubagentToolsFn(sourceCtx, opts.subagent))
    }

    if (include.includes('skill') && this.buildSkillToolsFn) {
      Object.assign(tools, this.buildSkillToolsFn(sourceCtx))
    }

    if (opts.disabledTools && opts.disabledTools.length > 0) {
      for (const name of opts.disabledTools) delete tools[name]
    }

    return tools
  }
}

export const toolRegistry = new ToolRegistry()
