// Quarantine ledger for the rose-email built-in. Append-only JSON at
// userData/email-quarantine.json, keyed by `${transport}:${messageId}` so
// IMAP UIDs and Gmail message IDs never alias.

import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, unlink } from 'fs/promises'

import type {
  EmailTransportKind,
  QuarantineEntry,
  EmailMessageSummary,
  QuarantineReason
} from '../../../shared/email'

const LEDGER_FILENAME = 'email-quarantine.json'

function ledgerPath(): string {
  return join(app.getPath('userData'), LEDGER_FILENAME)
}

function quarantineKey(transport: EmailTransportKind, messageId: string): string {
  return `${transport}:${messageId}`
}

async function readLedger(): Promise<QuarantineEntry[]> {
  try {
    const text = await readFile(ledgerPath(), 'utf-8')
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as QuarantineEntry[]) : []
  } catch {
    return []
  }
}

async function writeLedger(entries: QuarantineEntry[]): Promise<void> {
  await writeFile(ledgerPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

export async function listQuarantined(limit?: number): Promise<QuarantineEntry[]> {
  const all = await readLedger()
  const sorted = all.sort((a, b) => b.flaggedAt - a.flaggedAt)
  return limit != null ? sorted.slice(0, limit) : sorted
}

export async function isQuarantined(transport: EmailTransportKind, messageId: string): Promise<boolean> {
  const all = await readLedger()
  const key = quarantineKey(transport, messageId)
  const entry = all.find((e) => e.key === key)
  return !!entry && !entry.released
}

export async function recordQuarantine(args: {
  transport: EmailTransportKind
  messageId: string
  summary: EmailMessageSummary
  reasons: QuarantineReason[]
}): Promise<QuarantineEntry> {
  const all = await readLedger()
  const key = quarantineKey(args.transport, args.messageId)
  const existing = all.find((e) => e.key === key)
  if (existing) return existing
  const entry: QuarantineEntry = {
    key,
    transport: args.transport,
    messageId: args.messageId,
    summary: args.summary,
    flaggedAt: Date.now(),
    reasons: args.reasons,
    released: false
  }
  all.push(entry)
  await writeLedger(all)
  return entry
}

export async function releaseFromQuarantine(
  transport: EmailTransportKind,
  messageId: string
): Promise<QuarantineEntry | null> {
  const all = await readLedger()
  const key = quarantineKey(transport, messageId)
  const idx = all.findIndex((e) => e.key === key)
  if (idx === -1) return null
  all[idx] = { ...all[idx], released: true }
  await writeLedger(all)
  return all[idx]
}

/**
 * Clear the entire ledger. Called when the user switches transports — the
 * old transport's message IDs are meaningless to the new one, so we don't
 * carry old entries across.
 */
export async function clearQuarantineLedger(): Promise<void> {
  await unlink(ledgerPath()).catch(() => { /* tolerate */ })
}
