// Public facade for the rose-email built-in. IPC handlers and the agent
// tool handlers both call into this module — they don't reach into the
// transports directly. The facade is also where quarantine scanning runs:
// new messages are scanned on first sight and persisted in the ledger so
// they stay hidden from the agent's read tools until released.

import log from 'electron-log/main'

import type {
  DraftMessageArgs,
  EmailAccount,
  EmailFolder,
  EmailMessage,
  EmailMessageSummary,
  EmailStatus,
  ForwardArgs,
  ListMessagesArgs,
  QuarantineEntry,
  ReplyArgs,
  SaveImapTransportArgs,
  SearchArgs,
  SendMessageArgs
} from '../../../shared/email'

import { applySettingsPatch, readSettings } from '../settingsService'
import { buildAuthedClient, googleAuthGetStatus } from '../google/googleAuth'
import { google } from 'googleapis'
import { callGmail } from './gmailTransport'

import {
  EmailTransportNotConfiguredError,
  getActiveTransport,
  getActiveTransportKind
} from './emailTransport'
import { scanForQuarantine } from './quarantineHeuristics'
import {
  clearQuarantineLedger,
  isQuarantined,
  listQuarantined,
  recordQuarantine,
  releaseFromQuarantine
} from './quarantineStore'
import {
  clearImapPasswords,
  hasImapPasswords,
  writeImapPasswords
} from './imapCredentialsStore'

// ── Status / configuration ──────────────────────────────────────────────

export async function getEmailStatus(): Promise<EmailStatus> {
  const s = await readSettings()
  const email = s.email
  const auth = await googleAuthGetStatus()

  let ready = false
  if (email.transport === 'imap') {
    ready = (await hasImapPasswords()) && !!email.imap && !!email.smtp
  } else if (email.transport === 'google') {
    ready = auth.signedIn
  }

  return {
    transport: email.transport,
    account: email.account,
    ready,
    googleSignedIn: auth.signedIn,
    lastSyncAt: email.lastSyncAt
  }
}

async function patchEmailSettings(patch: Partial<typeof import('../../../shared/email').DEFAULT_EMAIL_SETTINGS>): Promise<void> {
  const s = await readSettings()
  await applySettingsPatch({ email: { ...s.email, ...patch } })
}

export async function saveImapTransport(args: SaveImapTransportArgs): Promise<EmailStatus> {
  await writeImapPasswords({
    imapPassword: args.imapPassword,
    smtpPassword: args.smtpPassword
  })
  await patchEmailSettings({
    transport: 'imap',
    account: args.account,
    imap: args.imap,
    smtp: args.smtp
  })
  return getEmailStatus()
}

/**
 * Switch to (or refresh) the Google transport. Verifies the current refresh
 * token covers the Gmail scope AND that the user's Google Cloud project has
 * the Gmail API enabled by making a lightweight `users.getProfile` call.
 * Any failure here is translated by `callGmail` into a `[email:<category>]`
 * tagged message the renderer recognizes.
 */
export async function activateGoogleTransport(): Promise<EmailStatus> {
  const auth = await googleAuthGetStatus()
  if (!auth.signedIn) {
    throw new Error('Sign in to Google before activating the Google email transport.')
  }
  await assertGmailReady()
  await patchEmailSettings({
    transport: 'google',
    account: { address: auth.accountEmail, displayName: null },
    imap: null,
    smtp: null
  })
  await clearImapPasswords()
  return getEmailStatus()
}

async function assertGmailReady(): Promise<void> {
  const client = await buildAuthedClient()
  if (!client) throw new Error('Not signed in to Google.')
  const gmail = google.gmail({ version: 'v1', auth: client })
  await callGmail(() => gmail.users.getProfile({ userId: 'me' }))
}

/**
 * Clear the active transport. Wipes the inactive-side credentials (IMAP
 * passwords if leaving IMAP; we leave the shared Google refresh token alone
 * since Contacts may still need it) and the quarantine ledger, which is keyed
 * on transport-specific message ids that won't match the new transport's ids.
 */
export async function clearEmailTransport(): Promise<EmailStatus> {
  await clearImapPasswords()
  await clearQuarantineLedger()
  await patchEmailSettings({
    transport: null,
    account: { address: null, displayName: null },
    imap: null,
    smtp: null,
    lastSyncAt: null
  })
  return getEmailStatus()
}

// ── Read operations (quarantine-aware) ──────────────────────────────────

async function filterQuarantined<T extends { id: string }>(items: T[]): Promise<T[]> {
  const kind = await getActiveTransportKind()
  if (!kind) return items
  const out: T[] = []
  for (const item of items) {
    if (!(await isQuarantined(kind, item.id))) out.push(item)
  }
  return out
}

export async function listFolders(): Promise<EmailFolder[]> {
  const t = await getActiveTransport()
  return t.listFolders()
}

export async function listMessages(args: ListMessagesArgs): Promise<EmailMessageSummary[]> {
  const t = await getActiveTransport()
  const summaries = await t.listMessages(args)
  return filterQuarantined(summaries)
}

export async function search(args: SearchArgs): Promise<EmailMessageSummary[]> {
  const t = await getActiveTransport()
  const summaries = await t.search(args)
  return filterQuarantined(summaries)
}

/**
 * Fetch a full message. Runs the quarantine scanner on first sight; if
 * flagged, the message is recorded in the ledger and the call throws so
 * the agent never reads the body. Already-released messages bypass scanning.
 */
export async function getMessage(messageId: string): Promise<EmailMessage> {
  const t = await getActiveTransport()
  if (await isQuarantined(t.kind, messageId)) {
    throw new Error(`Message ${messageId} is quarantined.`)
  }
  const msg = await t.getMessage(messageId)
  const settings = await readSettings()
  if (settings.email.quarantine?.autoFlag !== false) {
    const verdict = scanForQuarantine(msg)
    if (verdict.flagged) {
      await recordQuarantine({
        transport: t.kind,
        messageId,
        summary: toSummary(msg),
        reasons: verdict.reasons
      })
      await patchEmailSettings({ quarantine: { ...settings.email.quarantine, lastScanAt: Date.now() } })
      throw new Error(`Message ${messageId} was quarantined as suspected prompt-injection.`)
    }
  }
  await patchEmailSettings({ lastSyncAt: Date.now() })
  return msg
}

function toSummary(m: EmailMessage): EmailMessageSummary {
  return {
    id: m.id,
    folder: m.folder,
    threadId: m.threadId,
    from: m.from,
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
    read: m.read,
    labels: m.labels,
    hasAttachments: m.hasAttachments
  }
}

// ── Write operations ────────────────────────────────────────────────────

export async function createDraft(args: DraftMessageArgs): Promise<{ draftId: string }> {
  const t = await getActiveTransport()
  return t.createDraft(args)
}

export async function sendMessage(args: SendMessageArgs): Promise<{ messageId: string }> {
  const t = await getActiveTransport()
  return t.sendMessage(args)
}

export async function reply(args: ReplyArgs): Promise<{ messageId: string }> {
  const t = await getActiveTransport()
  return t.reply(args)
}

export async function forward(args: ForwardArgs): Promise<{ messageId: string }> {
  const t = await getActiveTransport()
  return t.forward(args)
}

// ── Triage ──────────────────────────────────────────────────────────────

export async function markRead(messageId: string, read: boolean): Promise<void> {
  const t = await getActiveTransport()
  await t.markRead(messageId, read)
}

export async function archiveMessage(messageId: string): Promise<void> {
  const t = await getActiveTransport()
  await t.archive(messageId)
}

export async function moveMessage(messageId: string, folder: string): Promise<void> {
  const t = await getActiveTransport()
  await t.move(messageId, folder)
}

export async function labelMessage(messageId: string, label: string, add: boolean): Promise<void> {
  const t = await getActiveTransport()
  await t.label(messageId, label, add)
}

export async function deleteMessage(messageId: string): Promise<void> {
  const t = await getActiveTransport()
  await t.deleteMessage(messageId)
}

// ── Quarantine ──────────────────────────────────────────────────────────

export async function listQuarantineEntries(limit?: number): Promise<QuarantineEntry[]> {
  return listQuarantined(limit)
}

export async function releaseQuarantineEntry(messageId: string): Promise<void> {
  const kind = await getActiveTransportKind()
  if (!kind) throw new EmailTransportNotConfiguredError()
  const entry = await releaseFromQuarantine(kind, messageId)
  if (!entry) {
    log.warn('[email] release_from_quarantine called for unknown messageId', messageId)
  }
}

// ── Misc helpers ────────────────────────────────────────────────────────

export type { EmailAccount }
