// Email transport interface + router for the rose-email built-in.
//
// The router (`getActiveTransport`) reads `settings.email.transport` and
// returns either the IMAP/SMTP implementation or the Gmail API
// implementation. Tool handlers and IPC go through this single chokepoint —
// no caller picks the transport directly.

import type {
  DraftMessageArgs,
  EmailFolder,
  EmailMessage,
  EmailMessageSummary,
  EmailTransportKind,
  ForwardArgs,
  ListMessagesArgs,
  ReplyArgs,
  SearchArgs,
  SendMessageArgs
} from '../../../shared/email'
import { readSettings } from '../settingsService'

/**
 * The contract every transport must satisfy. Identifiers (folder names,
 * message ids) are transport-specific opaque strings — the agent and the
 * renderer pass them back unchanged.
 */
export interface EmailTransportImpl {
  kind: EmailTransportKind

  listFolders(): Promise<EmailFolder[]>
  listMessages(args: ListMessagesArgs): Promise<EmailMessageSummary[]>
  search(args: SearchArgs): Promise<EmailMessageSummary[]>
  getMessage(messageId: string): Promise<EmailMessage>

  createDraft(args: DraftMessageArgs): Promise<{ draftId: string }>
  sendMessage(args: SendMessageArgs): Promise<{ messageId: string }>
  reply(args: ReplyArgs): Promise<{ messageId: string }>
  forward(args: ForwardArgs): Promise<{ messageId: string }>

  markRead(messageId: string, read: boolean): Promise<void>
  archive(messageId: string): Promise<void>
  move(messageId: string, folder: string): Promise<void>
  label(messageId: string, label: string, add: boolean): Promise<void>
  /** Moves to Trash. Never hard-deletes. */
  deleteMessage(messageId: string): Promise<void>
}

// Lazy-loaded transport instances so we don't import the IMAP/Gmail modules
// until we actually need them. The router rebuilds the instance whenever the
// settings change, since the transport carries the active credentials.

async function buildImapTransport(): Promise<EmailTransportImpl> {
  const mod = await import('./imapTransport')
  return mod.createImapTransport()
}

async function buildGmailTransport(): Promise<EmailTransportImpl> {
  const mod = await import('./gmailTransport')
  return mod.createGmailTransport()
}

export class EmailTransportNotConfiguredError extends Error {
  constructor() {
    super('No email transport configured. Set transport in Settings → Email.')
    this.name = 'EmailTransportNotConfiguredError'
  }
}

export async function getActiveTransport(): Promise<EmailTransportImpl> {
  const s = await readSettings()
  const kind = s.email?.transport
  if (kind === 'imap') return buildImapTransport()
  if (kind === 'google') return buildGmailTransport()
  throw new EmailTransportNotConfiguredError()
}

export async function getActiveTransportKind(): Promise<EmailTransportKind | null> {
  const s = await readSettings()
  return s.email?.transport ?? null
}
