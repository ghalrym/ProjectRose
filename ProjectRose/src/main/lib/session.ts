import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFile, writeFile, unlink } from 'fs/promises'

export interface Session {
  token: string
  deviceName: string
  user: {
    id: string
    email: string
    name: string
    avatar: string
  }
}

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.bin')
}

export async function loadSession(): Promise<Session | null> {
  let buf: Buffer
  try {
    buf = await readFile(sessionPath())
  } catch {
    return null
  }

  try {
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : Buffer.from(buf.toString('utf-8'), 'base64').toString('utf-8')
    return JSON.parse(json) as Session
  } catch {
    return null
  }
}

export async function saveSession(s: Session): Promise<void> {
  const json = JSON.stringify(s)
  let buf: Buffer
  if (safeStorage.isEncryptionAvailable()) {
    buf = safeStorage.encryptString(json)
  } else {
    console.warn('[session] safeStorage unavailable — writing base64-encoded plaintext fallback')
    buf = Buffer.from(Buffer.from(json, 'utf-8').toString('base64'), 'utf-8')
  }
  await writeFile(sessionPath(), buf)
}

export async function clearSession(): Promise<void> {
  try {
    await unlink(sessionPath())
  } catch {
    // ENOENT is fine — already gone.
  }
}
