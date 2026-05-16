import { routeRequest } from './llmClient'
import { loadSession } from '../lib/session'
import type { AppSettings, ModelConfig } from './settingsService'

/**
 * Pick the model to run a chat turn with.
 *
 * Lives in its own module so `ChatSession.run()` and `runAgentOnce()` can
 * both reach it without forming a cycle with `aiService.ts`. The function
 * encodes three rules: managed (projectrose) mode forces the account model,
 * single-model setups skip routing, and otherwise the router classifies the
 * user message and we match against model tags.
 */
export async function selectModel(userMessage: string, settings: AppSettings): Promise<ModelConfig> {
  const { models, defaultModelId, router, hostMode } = settings
  if (models.length === 0) {
    throw new Error('No models configured. Please add a model in Settings → Chat.')
  }

  if (hostMode === 'projectrose') {
    const session = await loadSession()
    if (!session?.token) {
      throw new Error('Sign in to your ProjectRose account to use the managed AI endpoint.')
    }
    return {
      id: 'projectrose-account',
      displayName: 'ProjectRose Account',
      provider: 'projectrose',
      modelName: 'managed',
      tags: ['account'],
    }
  }

  const defaultModel = models.find((m) => m.id === defaultModelId) ?? models[0]
  if (models.length === 1 || !router.enabled || !router.modelName) return defaultModel

  try {
    const category = await routeRequest(userMessage, router, settings.ollamaBaseUrl)
    const matched = models.find((m) =>
      m.tags.some(
        (tag) =>
          tag.toLowerCase().includes(category) || category.includes(tag.toLowerCase())
      )
    )
    return matched ?? defaultModel
  } catch {
    return defaultModel
  }
}

/**
 * Unwrap an error message from any of the shapes a provider SDK might raise.
 *
 * Provider responses sometimes serialise their error JSON into Error.message
 * (`{ error: { message: '...' } }`); this helper extracts the human-readable
 * string so callers can surface it without leaking the wrapper structure.
 */
export function extractErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const nested = parsed?.error as Record<string, unknown> | undefined
    const msg = nested?.message ?? parsed?.message ?? raw
    return String(msg)
  } catch {
    return raw
  }
}

/**
 * Pick the currently active model from settings without doing any routing —
 * used by context-status calls that need a token-budget guess up front (no
 * user message yet). Returns null when no models are configured.
 */
export function pickActiveModel(settings: AppSettings): ModelConfig | null {
  if (settings.hostMode === 'projectrose') {
    return {
      id: 'projectrose-account',
      displayName: 'ProjectRose Account',
      provider: 'projectrose',
      modelName: 'managed',
      tags: ['account'],
    }
  }
  return settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0] ?? null
}
