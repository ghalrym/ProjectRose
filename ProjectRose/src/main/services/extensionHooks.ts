import type {
  ChatHook,
  HookType,
  ThoughtHookEvent,
  MessageHookEvent,
  ToolCallHookEvent,
  UserMessageHookEvent,
  InjectionRecord
} from '../../shared/extensionHooks'
import { MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE } from '../../shared/extensionHooks'

interface RegisteredHooks {
  extensionId: string
  extensionName: string
  extensionIcon?: string
  rootPath: string
  hooks: ChatHook[]
}

// key = `${rootPath}/${id}` — Map preserves insertion order = registration order.
const registry = new Map<string, RegisteredHooks>()

// Per-extension injection counter for the current user turn. Reset by
// resetTurnBudgets() when the user sends a new message.
const turnBudget = new Map<string, number>()

export function registerHooks(
  key: string,
  info: { extensionId: string; extensionName: string; extensionIcon?: string; rootPath: string },
  hooks: ChatHook[]
): void {
  registry.set(key, { ...info, hooks })
}

export function unregisterHooks(key: string): void {
  registry.delete(key)
}

export function resetTurnBudgets(): void {
  turnBudget.clear()
}

function maxBudgetFor(matching: ChatHook[]): number {
  return matching.some((h) => h.allowMultiple) ? MAX_INJECTIONS_PER_TURN_WHEN_ALLOW_MULTIPLE : 1
}

async function fireInjectingHooks(
  type: 'on_thought' | 'on_message',
  event: ThoughtHookEvent | MessageHookEvent,
  rootPath: string
): Promise<InjectionRecord | null> {
  for (const [key, reg] of registry) {
    if (reg.rootPath !== rootPath) continue
    const matching = reg.hooks.filter((h) => h.type === type)
    if (matching.length === 0) continue

    const used = turnBudget.get(reg.extensionId) ?? 0
    if (used >= maxBudgetFor(matching)) continue

    for (const hook of matching) {
      let result: unknown
      try {
        result = await hook.handler(event)
      } catch (err) {
        console.error(`[rose-ext] hook ${reg.extensionId} ${type} threw:`, err)
        continue
      }
      if (
        result &&
        typeof result === 'object' &&
        'inject' in result &&
        typeof (result as { inject?: unknown }).inject === 'string' &&
        (result as { inject: string }).inject.length > 0
      ) {
        turnBudget.set(reg.extensionId, used + 1)
        return {
          extensionId: reg.extensionId,
          extensionName: reg.extensionName,
          extensionIcon: reg.extensionIcon,
          content: (result as { inject: string }).inject
        }
        // Note: stop iterating both this extension's remaining hooks and remaining
        // extensions — first injection wins. (return exits both loops.)
        // (This explicit comment exists because the order rule was a settled design choice.)
      }
    }
    // Reference unused 'key' to satisfy strict lint if it complains; insertion order
    // is maintained by Map and we use it implicitly.
    void key
  }
  return null
}

export async function fireThoughtHook(
  content: string,
  turnId: string,
  rootPath: string
): Promise<InjectionRecord | null> {
  const event: ThoughtHookEvent = { type: 'on_thought', content, turnId }
  return fireInjectingHooks('on_thought', event, rootPath)
}

export async function fireMessageHook(
  content: string,
  turnId: string,
  rootPath: string
): Promise<InjectionRecord | null> {
  const event: MessageHookEvent = { type: 'on_message', content, turnId }
  return fireInjectingHooks('on_message', event, rootPath)
}

export async function fireUserMessageHook(
  content: string,
  rootPath: string
): Promise<void> {
  const event: UserMessageHookEvent = { type: 'on_user_message', content }
  for (const [, reg] of registry) {
    if (reg.rootPath !== rootPath) continue
    for (const hook of reg.hooks) {
      if (hook.type !== 'on_user_message') continue
      try {
        await hook.handler(event)
      } catch (err) {
        console.error(`[rose-ext] hook ${reg.extensionId} on_user_message threw:`, err)
      }
    }
  }
}

export async function fireToolCallHook(
  payload: { toolName: string; params: Record<string, unknown>; result: string; error: boolean; turnId: string },
  rootPath: string
): Promise<void> {
  const event: ToolCallHookEvent = { type: 'on_tool_call', ...payload }
  for (const [, reg] of registry) {
    if (reg.rootPath !== rootPath) continue
    for (const hook of reg.hooks) {
      if (hook.type !== 'on_tool_call') continue
      try {
        await hook.handler(event)
      } catch (err) {
        console.error(`[rose-ext] hook ${reg.extensionId} on_tool_call threw:`, err)
      }
    }
  }
}

export type { HookType }
