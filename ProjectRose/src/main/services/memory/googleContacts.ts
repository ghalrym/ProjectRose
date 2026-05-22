import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'
import { URL } from 'url'
import { app, safeStorage, shell } from 'electron'
import { join } from 'path'
import { readFile, writeFile, unlink } from 'fs/promises'
import log from 'electron-log/main'
import { google, type people_v1 } from 'googleapis'
import { CodeChallengeMethod, type OAuth2Client } from 'google-auth-library'

import type {
  ContactKind,
  GoogleApplyResult,
  GooglePullEntry,
  GooglePullPlan,
  GooglePushEntry,
  GooglePushPlan,
  GoogleSyncStatus
} from '../../../shared/memory'
import { resolveGoogleClientId } from '../../../shared/googleOAuth'

import { applySettingsPatch, readSettings } from '../settingsService'
import {
  addContactNote,
  listContacts,
  newContact,
  readContactParsed
} from './contacts'
import { mapPerson, type MappedContact } from './googleContactsMapping'

// ── Token storage ────────────────────────────────────────────────────────
//
// Per ADR 0008, agent-global OAuth refresh tokens live encrypted in
// userData/<service>-session.bin (safeStorage). Settings.json carries only
// the non-secret bookkeeping (account email, last-pull/push timestamps).

const TOKEN_FILENAME = 'google-session.bin'

function tokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILENAME)
}

async function readRefreshToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await readFile(tokenPath())
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

async function writeRefreshToken(token: string): Promise<void> {
  const encrypted = safeStorage.encryptString(token)
  await writeFile(tokenPath(), encrypted)
}

async function clearRefreshToken(): Promise<void> {
  await unlink(tokenPath()).catch(() => { /* tolerate */ })
}

// ── Settings helpers ─────────────────────────────────────────────────────

async function readGoogleSettings(): Promise<{
  resolvedClientId: string
  accountEmail: string | null
  lastPullAt: number | null
  lastPushAt: number | null
  syncKinds: Record<ContactKind, boolean>
}> {
  const settings = await readSettings()
  const block = settings.memory?.googleSync
  const defaults: Record<ContactKind, boolean> = { person: true, business: true, website: false, other: false }
  return {
    // Falls through to MAIN_VITE_GOOGLE_CLIENT_ID env or the baked-in
    // constant. There is no per-install override path anymore.
    resolvedClientId: resolveGoogleClientId(),
    accountEmail: block?.accountEmail ?? null,
    lastPullAt: block?.lastPullAt ?? null,
    lastPushAt: block?.lastPushAt ?? null,
    syncKinds: { ...defaults, ...(block?.syncKinds ?? {}) }
  }
}

async function patchGoogleSettings(patch: {
  accountEmail?: string | null
  lastPullAt?: number | null
  lastPushAt?: number | null
}): Promise<void> {
  const settings = await readSettings()
  const current = settings.memory
  await applySettingsPatch({
    memory: {
      ...current,
      googleSync: {
        ...current.googleSync,
        ...patch
      }
    }
  })
}

// ── OAuth client ─────────────────────────────────────────────────────────

const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email'
]

const PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,addresses,organizations,urls,biographies'

/**
 * Build an OAuth2Client without a client_secret. Per RFC 8252 the Electron
 * renderer is a public OAuth client; PKCE (RFC 7636) is the protection at
 * the token endpoint. Google's docs list client_secret as Optional for the
 * loopback flow's token exchange, and google-auth-library omits the param
 * from the request body when the secret is undefined.
 */
function newOAuthClient(clientId: string, redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2({ clientId, redirectUri })
}

async function buildAuthedClient(): Promise<OAuth2Client | null> {
  const refreshToken = await readRefreshToken()
  if (!refreshToken) return null
  const s = await readGoogleSettings()
  if (!s.resolvedClientId) return null
  // Refresh the access token manually so we know it's fresh and we never
  // depend on the SDK's auto-refresh path (which has the same client_secret
  // serialization quirk that bit us on initial sign-in).
  const fresh = await refreshAccessToken({
    clientId: s.resolvedClientId,
    refreshToken
  })
  const client = newOAuthClient(s.resolvedClientId)
  client.setCredentials({
    refresh_token: refreshToken,
    access_token: fresh.access_token,
    expiry_date: fresh.expires_in ? Date.now() + fresh.expires_in * 1000 : undefined
  })
  return client
}

async function refreshAccessToken(args: {
  clientId: string
  refreshToken: string
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    grant_type: 'refresh_token'
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })
  const bodyText = await res.text()
  if (!res.ok) {
    let parsed: { error?: string; error_description?: string } = {}
    try { parsed = JSON.parse(bodyText) } catch { /* not JSON */ }
    const code = parsed.error ?? 'refresh_failed'
    const desc = parsed.error_description ? ` — ${parsed.error_description}` : ''
    throw new Error(`Google token refresh failed: ${res.status} ${code}${desc}`)
  }
  try {
    return JSON.parse(bodyText) as TokenResponse
  } catch {
    throw new Error(`Google token refresh returned non-JSON: ${bodyText.slice(0, 200)}`)
  }
}

// ── Status / sign-in / sign-out ─────────────────────────────────────────

export async function googleGetStatus(): Promise<GoogleSyncStatus> {
  const s = await readGoogleSettings()
  const hasClientId = !!s.resolvedClientId
  const hasToken = !!(await readRefreshToken())
  return {
    // With a baked-in client_id this is true by default. Stays here as a
    // defensive signal in case an OSS fork strips the constant AND the env
    // var AND the user hasn't pasted an override.
    credentialsConfigured: hasClientId,
    signedIn: hasClientId && hasToken,
    accountEmail: s.accountEmail,
    lastPullAt: s.lastPullAt,
    lastPushAt: s.lastPushAt
  }
}

/**
 * Loopback OAuth flow. Starts a one-shot HTTP server on a free port, opens
 * the Google consent page in the user's default browser, waits for the
 * redirect with the auth code, exchanges it for tokens, persists the
 * refresh token, then returns the new status.
 *
 * Throws if credentials aren't configured, the user denies consent, or
 * Google doesn't return a refresh token (we force `prompt: 'consent'` to
 * defeat that).
 */
export async function googleSignIn(): Promise<GoogleSyncStatus> {
  const s = await readGoogleSettings()
  if (!s.resolvedClientId) {
    throw new Error('Google Contacts sync is unavailable in this build (no OAuth client_id). Set MAIN_VITE_GOOGLE_CLIENT_ID at build time to enable it.')
  }

  const { port, server } = await startLoopbackServer()
  const redirectUri = `http://127.0.0.1:${port}/callback`
  const flow = await startPkceFlow(s.resolvedClientId, redirectUri)

  const authUrl = flow.client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    // PKCE per RFC 7636 — Google's token endpoint verifies that the SHA-256
    // of code_verifier (sent on exchange) matches code_challenge (sent now).
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: flow.codeChallenge
  })

  try {
    await shell.openExternal(authUrl)
    const code = await waitForCode(server)
    // Manual token exchange instead of OAuth2Client.getToken() — the SDK
    // serializes an undefined client_secret as the literal string
    // "undefined" in some code paths, which Google rejects as
    // `invalid_request`. By POSTing the form body ourselves we can omit
    // client_secret cleanly (Google's loopback flow docs mark it Optional)
    // and we surface the actual error_description on failure.
    const tokens = await exchangeCodeForTokens({
      clientId: s.resolvedClientId,
      redirectUri,
      code,
      codeVerifier: flow.codeVerifier
    })
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Revoke this app at https://myaccount.google.com/permissions and try again.'
      )
    }
    await writeRefreshToken(tokens.refresh_token)

    // Fetch the signed-in account's email for display. Set credentials on
    // the SDK client so it can attach the access token; the SDK auto-refresh
    // path is patched separately (see buildAuthedClient).
    flow.client.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
    })
    const oauth2 = google.oauth2({ version: 'v2', auth: flow.client })
    const me = await oauth2.userinfo.get()
    const email = me.data.email ?? null
    await patchGoogleSettings({ accountEmail: email })
  } finally {
    server.close()
  }

  return googleGetStatus()
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
}

/**
 * POST to https://oauth2.googleapis.com/token with the loopback-flow params
 * Google's native-app docs prescribe — and crucially, *without* a
 * client_secret field, since this is a public client using PKCE.
 *
 * On failure the response body is parsed for `error` / `error_description`
 * and rethrown verbatim so the caller sees something actionable instead of
 * a bare "invalid_request".
 */
async function exchangeCodeForTokens(args: {
  clientId: string
  redirectUri: string
  code: string
  codeVerifier: string
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: args.redirectUri
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })
  const bodyText = await res.text()
  if (!res.ok) {
    let parsed: { error?: string; error_description?: string; error_uri?: string } = {}
    try { parsed = JSON.parse(bodyText) } catch { /* not JSON */ }
    const code = parsed.error ?? 'token_exchange_failed'
    const desc = parsed.error_description ? ` — ${parsed.error_description}` : ''
    const ref = parsed.error_uri ? ` (see ${parsed.error_uri})` : ''
    throw new Error(`Google token exchange failed: ${res.status} ${code}${desc}${ref}`)
  }
  try {
    return JSON.parse(bodyText) as TokenResponse
  } catch {
    throw new Error(`Google token exchange returned non-JSON: ${bodyText.slice(0, 200)}`)
  }
}

async function startPkceFlow(clientId: string, redirectUri: string): Promise<{
  client: OAuth2Client
  codeVerifier: string
  codeChallenge: string
}> {
  const client = newOAuthClient(clientId, redirectUri)
  const codes = await client.generateCodeVerifierAsync()
  // The SDK types both fields as optional but the implementation always
  // returns non-empty strings — defensive guard so a future SDK change
  // surfaces here instead of as a confusing 400 from Google.
  if (!codes.codeVerifier || !codes.codeChallenge) {
    throw new Error('Failed to generate PKCE verifier/challenge.')
  }
  return { client, codeVerifier: codes.codeVerifier, codeChallenge: codes.codeChallenge }
}

export async function googleSignOut(): Promise<GoogleSyncStatus> {
  await clearRefreshToken()
  await patchGoogleSettings({ accountEmail: null })
  return googleGetStatus()
}

// ── Pull (Google → Memory) ───────────────────────────────────────────────

async function listAllGooglePeople(client: OAuth2Client): Promise<people_v1.Schema$Person[]> {
  const people = google.people({ version: 'v1', auth: client })
  const out: people_v1.Schema$Person[] = []
  let pageToken: string | undefined
  do {
    const res = await people.people.connections.list({
      resourceName: 'people/me',
      personFields: PERSON_FIELDS,
      pageSize: 200,
      pageToken
    })
    if (res.data.connections) out.push(...res.data.connections)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

export async function googlePreviewPull(): Promise<GooglePullPlan> {
  const client = await buildAuthedClient()
  if (!client) throw new Error('Not signed in to Google.')

  const settings = await readGoogleSettings()
  const persons = await listAllGooglePeople(client)
  const create: GooglePullEntry[] = []
  const update: GooglePullEntry[] = []
  const skippedByKind: { entity: string; kind: ContactKind }[] = []
  let unchanged = 0

  for (const person of persons) {
    const mapped = mapPerson(person)
    if (!mapped) continue
    const existing = await readContactParsed(mapped.entity)

    if (!existing) {
      // New contact: gets default kind ('person' from mapPerson). Skip if
      // that kind isn't in the user's syncKinds set.
      if (!settings.syncKinds[mapped.kind]) {
        skippedByKind.push({ entity: mapped.entity, kind: mapped.kind })
        continue
      }
      create.push({
        entity: mapped.entity,
        kind: mapped.kind,
        googleResourceName: mapped.googleResourceName,
        newNotes: mapped.notes
      })
      continue
    }

    // Existing contact: respect its already-assigned kind.
    if (!settings.syncKinds[existing.kind]) {
      skippedByKind.push({ entity: mapped.entity, kind: existing.kind })
      continue
    }
    const existingLower = new Set(existing.notes.map((n) => n.toLowerCase()))
    const newNotes = mapped.notes.filter((n) => !existingLower.has(n.toLowerCase()))
    if (newNotes.length === 0) {
      unchanged += 1
    } else {
      update.push({
        entity: mapped.entity,
        kind: existing.kind,
        googleResourceName: mapped.googleResourceName,
        newNotes
      })
    }
  }

  return { fetched: persons.length, create, update, unchanged, skippedByKind }
}

export async function googleApplyPull(plan: GooglePullPlan): Promise<GoogleApplyResult> {
  try {
    for (const entry of plan.create) {
      // Pass kind so newContact persists it in the file's `- kind:` bullet
      // instead of defaulting to 'other' (which would mis-classify everything
      // Google sent over).
      await newContact(entry.entity, entry.kind)
      for (const note of entry.newNotes) {
        await addContactNote(entry.entity, note)
      }
    }
    for (const entry of plan.update) {
      for (const note of entry.newNotes) {
        await addContactNote(entry.entity, note)
      }
    }
    const appliedAt = Date.now()
    await patchGoogleSettings({ lastPullAt: appliedAt })
    const total = plan.create.length + plan.update.length
    return {
      appliedAt,
      ok: true,
      message: `Pulled ${total} contact${total === 1 ? '' : 's'} (${plan.create.length} new, ${plan.update.length} updated).`
    }
  } catch (err) {
    log.error('[google-contacts] applyPull failed', err)
    return { appliedAt: Date.now(), ok: false, message: errMessage(err) }
  }
}

// ── Push (Memory → Google) ───────────────────────────────────────────────

export async function googlePreviewPush(): Promise<GooglePushPlan> {
  const client = await buildAuthedClient()
  if (!client) throw new Error('Not signed in to Google.')

  const settings = await readGoogleSettings()
  const local = await listContacts()
  const googlePersons = await listAllGooglePeople(client)
  const googleNamesLower = new Set<string>()
  for (const p of googlePersons) {
    const name = mapPerson(p)?.entity
    if (name) googleNamesLower.add(name.toLowerCase())
  }

  const create: GooglePushEntry[] = []
  const skip: { entity: string; kind: ContactKind; reason: string }[] = []
  for (const entity of local) {
    const parsed = await readContactParsed(entity)
    const kind = parsed?.kind ?? 'other'

    if (!settings.syncKinds[kind]) {
      skip.push({ entity, kind, reason: `kind '${kind}' is not enabled for sync` })
      continue
    }
    if (googleNamesLower.has(entity.toLowerCase())) {
      skip.push({ entity, kind, reason: 'already in Google' })
      continue
    }
    create.push({ entity, kind, reason: 'missing-in-google' })
  }

  return { localCount: local.length, create, skip }
}

export async function googleApplyPush(plan: GooglePushPlan): Promise<GoogleApplyResult> {
  const client = await buildAuthedClient()
  if (!client) return { appliedAt: Date.now(), ok: false, message: 'Not signed in to Google.' }

  const people = google.people({ version: 'v1', auth: client })
  let created = 0
  try {
    for (const entry of plan.create) {
      await people.people.createContact({
        requestBody: { names: [{ givenName: entry.entity }] }
      })
      created += 1
    }
    const appliedAt = Date.now()
    await patchGoogleSettings({ lastPushAt: appliedAt })
    return {
      appliedAt,
      ok: true,
      message: `Created ${created} contact${created === 1 ? '' : 's'} in Google.`
    }
  } catch (err) {
    log.error('[google-contacts] applyPush failed', err)
    return { appliedAt: Date.now(), ok: false, message: errMessage(err) }
  }
}

// ── Loopback HTTP server helpers ─────────────────────────────────────────

async function startLoopbackServer(): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null
      if (!addr) {
        server.close()
        reject(new Error('Failed to bind loopback port for Google sign-in.'))
        return
      }
      resolve({ port: addr.port, server })
    })
  })
}

function waitForCode(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Google sign-in timed out (no callback received within 5 minutes).'))
    }, 5 * 60 * 1000)

    server.on('request', (req, res) => {
      try {
        if (!req.url) return
        const url = new URL(req.url, `http://127.0.0.1`)
        if (url.pathname !== '/callback') {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        if (error) {
          res.statusCode = 400
          res.end(callbackHtml(`Sign-in failed: ${error}`))
          clearTimeout(timeout)
          reject(new Error(`Google returned ${error}`))
          return
        }
        if (!code) {
          res.statusCode = 400
          res.end(callbackHtml('No authorization code returned.'))
          clearTimeout(timeout)
          reject(new Error('Google did not return an authorization code.'))
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html')
        res.end(callbackHtml('Sign-in complete. You can close this tab and return to ProjectRose.'))
        clearTimeout(timeout)
        resolve(code)
      } catch (err) {
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}

function callbackHtml(message: string): string {
  return `<!doctype html><html><head><title>ProjectRose · Google Sign-in</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}main{max-width:480px;padding:32px;text-align:center}h1{font-weight:400;letter-spacing:1px}</style>
</head><body><main><h1>ProjectRose</h1><p>${escapeHtml(message)}</p></main></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
