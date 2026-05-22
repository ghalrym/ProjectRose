// IMAP/SMTP password store for the rose-email built-in. Both passwords are
// serialized to a single JSON blob and encrypted with Electron's safeStorage,
// then written to userData/email-imap.bin — same pattern as
// google-oauth-secret.bin (ADR 0008 / 0009).
//
// The non-secret bits (host/port/secure/username) live in
// settings.email.imap and settings.email.smtp; this file holds only the
// passwords.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFile, writeFile, unlink } from 'fs/promises'

const SECRET_FILENAME = 'email-imap.bin'

function secretPath(): string {
  return join(app.getPath('userData'), SECRET_FILENAME)
}

interface StoredPasswords {
  imapPassword: string
  smtpPassword: string
}

export async function readImapPasswords(): Promise<StoredPasswords | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const buf = await readFile(secretPath())
    const decrypted = safeStorage.decryptString(buf)
    const parsed = JSON.parse(decrypted)
    if (
      typeof parsed?.imapPassword !== 'string' ||
      typeof parsed?.smtpPassword !== 'string'
    ) {
      return null
    }
    return { imapPassword: parsed.imapPassword, smtpPassword: parsed.smtpPassword }
  } catch {
    return null
  }
}

export async function writeImapPasswords(passwords: StoredPasswords): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain is unavailable; cannot store IMAP credentials securely.')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(passwords))
  await writeFile(secretPath(), encrypted)
}

export async function clearImapPasswords(): Promise<void> {
  await unlink(secretPath()).catch(() => { /* tolerate */ })
}

export async function hasImapPasswords(): Promise<boolean> {
  return (await readImapPasswords()) !== null
}
