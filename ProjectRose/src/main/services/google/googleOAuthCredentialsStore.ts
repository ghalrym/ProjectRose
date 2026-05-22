// User-supplied Google OAuth credentials store. The clientId lives in
// ~/.rose/settings.json under `googleAuth`; the clientSecret is encrypted
// with Electron's safeStorage and written to userData/google-oauth-secret.bin
// (same shape as the refresh-token file from ADR 0008). See ADR 0009.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFile, writeFile, unlink } from 'fs/promises'

import {
  type GoogleOAuthCredentials,
  hasGoogleOAuthCredentials
} from '../../../shared/googleOAuth'
import { applySettingsPatch, readSettings } from '../settingsService'

const SECRET_FILENAME = 'google-oauth-secret.bin'

function secretPath(): string {
  return join(app.getPath('userData'), SECRET_FILENAME)
}

export async function readGoogleClientSecret(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await readFile(secretPath())
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

async function writeGoogleClientSecret(secret: string): Promise<void> {
  const encrypted = safeStorage.encryptString(secret)
  await writeFile(secretPath(), encrypted)
}

async function deleteGoogleClientSecret(): Promise<void> {
  await unlink(secretPath()).catch(() => { /* tolerate missing file */ })
}

export async function readGoogleClientId(): Promise<string> {
  const s = await readSettings()
  return s.googleAuth?.clientId?.trim() ?? ''
}

/**
 * Combined view used by the OAuth flow. Returns null when either half of the
 * credential pair is missing, so callers can short-circuit with a clear
 * "not configured" state instead of trying to sign in with half a credential.
 */
export async function readGoogleOAuthCredentials(): Promise<GoogleOAuthCredentials | null> {
  const clientId = await readGoogleClientId()
  const clientSecret = (await readGoogleClientSecret()) ?? ''
  const pair = { clientId, clientSecret }
  return hasGoogleOAuthCredentials(pair) ? pair : null
}

export async function saveGoogleOAuthCredentials(
  creds: GoogleOAuthCredentials
): Promise<void> {
  const clientId = creds.clientId.trim()
  const clientSecret = creds.clientSecret.trim()
  if (!clientId || !clientSecret) {
    throw new Error('Both clientId and clientSecret are required.')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain is unavailable; cannot store Google OAuth secret securely.'
    )
  }
  await writeGoogleClientSecret(clientSecret)
  await applySettingsPatch({ googleAuth: { clientId } })
}

export async function clearGoogleOAuthCredentials(): Promise<void> {
  await deleteGoogleClientSecret()
  await applySettingsPatch({ googleAuth: undefined })
}

export async function googleOAuthCredentialsConfigured(): Promise<boolean> {
  return (await readGoogleOAuthCredentials()) !== null
}
