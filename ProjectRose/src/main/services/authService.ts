import { app, BrowserWindow, shell } from 'electron'
import { randomBytes } from 'crypto'
import { hostname } from 'os'
import type { Server } from 'http'
import { IPC } from '../../shared/ipcChannels'
import { WEB_BASE_URL } from '../lib/webConfig'
import { startLoopbackServer } from '../lib/loopback'
import { loadSession, saveSession, clearSession, type Session } from '../lib/session'

const PAIRING_TIMEOUT_MS = 5 * 60 * 1000

interface PendingPairing {
  server: Server
  cancel: (err: Error) => void
}

let pending: PendingPairing | null = null

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function emitChanged(session: Session | null): void {
  notifyRenderer(IPC.AUTH_CHANGED, session
    ? { loggedIn: true, email: session.user.email, name: session.user.name, avatar: session.user.avatar }
    : { loggedIn: false, email: '', name: '', avatar: '' })
}

interface ExchangeResponse {
  token: string
  token_type: string
  device_name: string
  user: { id: string; email: string; name: string; avatar: string }
}

async function exchangeCode(code: string): Promise<ExchangeResponse> {
  const res = await fetch(`${WEB_BASE_URL}/api/auth/device/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Exchange failed (${res.status}): ${body || res.statusText}`)
  }
  return await res.json() as ExchangeResponse
}

export async function openAuthWindow(): Promise<void> {
  if (pending) {
    // Cancel any in-flight pairing before starting a new one.
    cancelPairing()
  }

  const state = randomBytes(16).toString('hex')
  const deviceName = `${hostname()} · ${app.getName()}`

  const { server, port, codePromise } = await startLoopbackServer(state)

  const url = new URL('/auth-device.html', WEB_BASE_URL)
  url.searchParams.set('state', state)
  url.searchParams.set('port', String(port))
  url.searchParams.set('name', deviceName)
  const authUrl = url.toString()

  let cancelHandler!: (err: Error) => void
  const cancellation = new Promise<never>((_, reject) => { cancelHandler = reject })
  pending = { server, cancel: cancelHandler }

  notifyRenderer(IPC.AUTH_PAIRING_PENDING, { url: authUrl })
  shell.openExternal(authUrl).catch(() => {
    // openExternal can fail on headless Linux. The renderer's "Copy link"
    // fallback uses the url payload above so the user can paste it manually.
  })

  let timeoutHandle: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Pairing timed out — try again from Settings.')), PAIRING_TIMEOUT_MS)
  })

  try {
    const code = await Promise.race([codePromise, timeoutPromise, cancellation])
    console.log(`[auth] received pairing code (length=${code.length})`)
    const response = await exchangeCode(code)
    const session: Session = {
      token: response.token,
      deviceName: response.device_name,
      user: response.user,
    }
    await saveSession(session)
    console.log(`[auth] signed in as user ${session.user.id} on device "${session.deviceName}"`)
    emitChanged(session)
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (!server.listening) {
      // already closed
    } else {
      server.close()
    }
    pending = null
  }
}

export function cancelPairing(): void {
  if (!pending) return
  const { server, cancel } = pending
  pending = null
  try { server.close() } catch { /* best effort */ }
  cancel(new Error('Sign-in cancelled'))
}

export async function handleLogout(): Promise<void> {
  const session = await loadSession()
  if (session) {
    try {
      await fetch(`${WEB_BASE_URL}/api/auth/device/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      })
    } catch {
      // best-effort; we still clear local state below.
    }
  }
  await clearSession()
  emitChanged(null)
}

export interface AuthStatus {
  loggedIn: boolean
  email: string
  name: string
  avatar: string
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const session = await loadSession()
  if (!session) return { loggedIn: false, email: '', name: '', avatar: '' }
  return { loggedIn: true, email: session.user.email, name: session.user.name, avatar: session.user.avatar }
}

export interface UsageInfo {
  plan: string
  plan_budget_usd: number
  month_cost_usd: number
  month_remaining_usd: number
  pct: number
  over_budget: boolean
}

export type UsageResult =
  | { ok: true; usage: UsageInfo }
  | { ok: false; error: string }

export async function fetchUsage(): Promise<UsageResult> {
  const session = await loadSession()
  if (!session) return { ok: false, error: 'Not signed in' }
  try {
    const res = await fetch(`${WEB_BASE_URL}/api/usage/check`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Usage check failed (${res.status})${body ? `: ${body}` : ''}` }
    }
    const usage = await res.json() as UsageInfo
    return { ok: true, usage }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
