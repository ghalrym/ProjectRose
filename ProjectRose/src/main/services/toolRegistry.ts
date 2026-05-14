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
// This is the skeleton slice. Today only the `core` source flows through
// the registry; subagent, skill, and extension tools are merged inline by
// the caller. Later issues (#14, #15) move the rest in.
//
// See PRD #12 for the broader design.

import type { ExtensionToolCtx } from '../../shared/extension-types'

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

export interface GetToolsOpts extends ToolSourceContext {
  disabledTools?: string[]
  include?: readonly ToolSourceName[]
}

const ALL_SOURCES: readonly ToolSourceName[] = ['core', 'subagent', 'skill', 'extension'] as const

export class ToolRegistry {
  private buildCoreToolsFn: BuildCoreToolsFn | null = null

  registerCoreTools(buildFn: BuildCoreToolsFn): void {
    this.buildCoreToolsFn = buildFn
  }

  getToolsForSession(opts: GetToolsOpts): ToolMap {
    const include = opts.include ?? ALL_SOURCES
    const tools: ToolMap = {}

    if (include.includes('core') && this.buildCoreToolsFn) {
      Object.assign(tools, this.buildCoreToolsFn({
        rootPath: opts.rootPath,
        emit: opts.emit,
        toolCtx: opts.toolCtx,
        hookCtx: opts.hookCtx
      }))
    }

    // subagent, skill, extension sources land in later issues (#14, #15).

    if (opts.disabledTools && opts.disabledTools.length > 0) {
      for (const name of opts.disabledTools) delete tools[name]
    }

    return tools
  }
}

export const toolRegistry = new ToolRegistry()
