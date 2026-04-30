export type HookType = 'on_thought' | 'on_message' | 'on_tool_call' | 'on_user_message'

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

// Fires once per user-initiated turn, before any model output. Auto-injection
// iterations do NOT re-fire this — only fresh user messages do. Notification
// only; injections are not collected from this hook.
export interface UserMessageHookEvent {
  type: 'on_user_message'
  content: string
}

export type HookEvent = ThoughtHookEvent | MessageHookEvent | ToolCallHookEvent | UserMessageHookEvent

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
