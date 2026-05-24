import { loadSession } from '../lib/session'
import type { AppSettings, ModelConfig } from './settingsService'

const PROJECTROSE_MODEL: ModelConfig = {
  provider: 'projectrose',
  modelName: 'managed',
}

/**
 * Pick the model to run a chat turn with.
 *
 * Two paths: signed in to ProjectRose → the managed account model; otherwise
 * the single Ollama model configured under Settings → Providers.
 */
export async function selectModel(_userMessage: string, settings: AppSettings): Promise<ModelConfig> {
  if (settings.hostMode === 'projectrose') {
    const session = await loadSession()
    if (!session?.token) {
      throw new Error('Sign in to your ProjectRose account to use the managed AI endpoint.')
    }
    return PROJECTROSE_MODEL
  }

  if (!settings.ollamaModelName) {
    throw new Error('No Ollama model configured. Set one in Settings → Providers → Ollama.')
  }
  return { provider: 'ollama', modelName: settings.ollamaModelName }
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
 * Pick the active model from settings without making any decisions that need
 * a user message — used by context-status calls that compute a token-budget
 * guess up front. Returns null when nothing is configured.
 */
export function pickActiveModel(settings: AppSettings): ModelConfig | null {
  if (settings.hostMode === 'projectrose') return PROJECTROSE_MODEL
  return settings.ollamaModelName
    ? { provider: 'ollama', modelName: settings.ollamaModelName }
    : null
}
