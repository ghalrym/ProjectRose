import { defineIpc, method } from '../../shared/ipc/defineIpc'
import { openAuthWindow } from './authService'
import type { AuthStatus, UsageResult } from './authService'

export const authIpc = defineIpc('auth', {
  login: method<[], void>(),
  logout: method<[], void>(),
  cancel: method<[], void>(),
  getStatus: method<[], AuthStatus>(),
  getUsage: method<[], UsageResult>()
})

// Wraps openAuthWindow so the manifest's login handler can surface a
// structured Error to the renderer (the AccountView relies on the message
// to drop the pairing-pending state).
export async function loginViaAuthWindow(): Promise<void> {
  try {
    await openAuthWindow()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign-in failed'
    throw new Error(message)
  }
}
