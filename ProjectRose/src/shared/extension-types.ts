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
    pageView?: boolean
    main?: boolean
    projectSettings?: boolean
    globalSettings?: boolean
    agentTools?: boolean
    tools?: Array<{ name: string; displayName: string; description: string }>
    chatHooks?: boolean
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
