export type HookType = 'on_thought' | 'on_message' | 'on_tool_call'

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

export interface ToolCallHookEvent {
  type: 'on_tool_call'
  toolName: string
  params: Record<string, unknown>
  result: string
  error: boolean
  turnId: string
}

export type HookEvent = ThoughtHookEvent | MessageHookEvent | ToolCallHookEvent

export interface HookResult {
  inject?: string
}

export interface ChatHook {
  type: HookType
  handler: (event: HookEvent) => Promise<HookResult | void> | HookResult | void
  allowMultiple?: boolean
}

export interface InjectionRecord {
  extensionId: string
  extensionName: string
  extensionIcon?: string
  content: string
}

export const MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE = 5
