export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  latin?: string
  icon?: string
  navItem?: {
    label: string
    iconName: string
  }
  provides: {
    // Renderer-side: the extension contributes a page view rendered inside
    // the host's main nav. Drives whether a renderer bundle is loaded.
    pageView?: boolean
    // Main-process: the extension ships a `main.js` whose `register(ctx)`
    // entry point the host should evaluate at load time.
    main?: boolean
    // Settings surfaces: declares the extension exposes a settings view that
    // belongs to the project or to global user settings, respectively.
    projectSettings?: boolean
    globalSettings?: boolean
    // ctx.registerTools(...) is available. Each entry below is display
    // metadata for the host's Settings → Tools UI.
    // `defaultDisabled: true` adds the tool to the project's disabledTools
    // list when the extension is installed, so the agent does not see it
    // until the user explicitly enables it in Settings → Tools.
    agentTools?: boolean
    tools?: Array<{ name: string; displayName: string; description: string; defaultDisabled?: boolean }>
    // ctx.registerHooks(...) is available.
    chatHooks?: boolean
    // Optional declaration of which hook types this extension provides and
    // how the host should dispatch them. If absent, hooks default to
    // `injectionPolicy: 'first-wins'` and `priority: 100`. When present,
    // the host warns at load time if a declared hook type isn't actually
    // registered, and if a runtime-registered hook's type isn't declared.
    hooks?: Array<{
      type: 'on_thought' | 'on_message' | 'on_tool_call' | 'on_user_message' | 'on_token'
      injectionPolicy?: 'first-wins' | 'all'
      priority?: number
    }>
    // ctx.openAgentSession(...) is available.
    agentSession?: boolean
    // ctx.runBackgroundAgent(...) is available.
    backgroundAgent?: boolean
    // ctx.runDetachedRunWithTools(...) is available — a sibling to
    // backgroundAgent that runs a one-shot Agent turn with an explicit tool
    // allowlist and returns a structured transcript instead of a single
    // string. See ADR 0014 for the contract amendment rationale.
    detachedRunWithTools?: boolean
    // ctx.notifyStatus(...) is available.
    notifyStatus?: boolean
    // ctx.broadcast(...) is available.
    broadcast?: boolean
    // Relative path inside the extension bundle pointing at a markdown file
    // whose contents are appended to the system prompt as the extension's
    // default. Resolved against the extension's installPath; must stay inside
    // it. The user can override per-project via .projectrose/prompts/<id>.md.
    systemPrompt?: string
  }
}

export interface InstalledExtension {
  manifest: ExtensionManifest
  installPath: string
  enabled: boolean
}

export interface ExtensionToolParameter {
  type: 'string' | 'number' | 'boolean'
  description: string
  optional?: boolean
}

export interface ExtensionToolDefinition {
  name: string
  description: string
  parameters: Record<string, ExtensionToolParameter>
  execute: (params: Record<string, unknown>) => Promise<string>
}

// Context passed to extension tool execute functions. `sessionId` is the
// host chat session id when invoked from user chat, or a per-call uuid for
// one-shot background-agent runs. `turnId` is set only inside user chat.
export interface ExtensionToolCtx {
  sessionId: string
  turnId?: string
}

// Runtime tool entry registered by extension main modules via ctx.registerTools()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ExtensionToolEntry {
  name: string
  description: string
  schema: Record<string, any>
  execute: (input: Record<string, unknown>, projectRoot: string, toolCtx: ExtensionToolCtx) => Promise<string>
}
