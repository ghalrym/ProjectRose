// Shared types for the rose-email built-in extension.
//
// Lives in src/shared/ so the renderer (PageView/SettingsView), the main
// process (IPC handlers, transports, tool handlers), and the preload bridge
// can all import the same shapes without crossing layers.

export type EmailTransportKind = 'imap' | 'google'

export interface ImapConfig {
  host: string
  port: number
  secure: boolean              // TLS
  username: string
  // password is NOT stored here — it lives encrypted in
  // userData/email-imap.bin via safeStorage.
}

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean              // STARTTLS / TLS
  username: string
  // password also in userData/email-imap.bin.
}

export interface EmailAccount {
  address: string | null       // primary email address
  displayName: string | null
}

export interface EmailSettings {
  transport: EmailTransportKind | null   // null = unconfigured / cleared
  account: EmailAccount
  imap: ImapConfig | null
  smtp: SmtpConfig | null
  lastSyncAt: number | null
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  transport: null,
  account: { address: null, displayName: null },
  imap: null,
  smtp: null,
  lastSyncAt: null
}

// ── Domain shapes ────────────────────────────────────────────────────────

export interface EmailAddress {
  address: string
  name?: string
}

export interface EmailFolder {
  /** Path the transport uses to address the folder (IMAP path or Gmail label id). */
  id: string
  /** Human-readable name. */
  name: string
  /** Total messages in the folder. */
  total?: number
  /** Unread count. */
  unread?: number
}

/**
 * A single message. Body is text/plain unless `bodyHtml` is also populated.
 */
export interface EmailMessage {
  /** Stable transport-specific ID (IMAP UID-with-mailbox or Gmail message ID). */
  id: string
  folder: string
  threadId?: string
  from: EmailAddress | null
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  subject: string
  /** Unix ms. */
  date: number
  /** Plain text body (best-effort extraction from HTML if only HTML was sent). */
  body: string
  /** Raw HTML body if the message had one. */
  bodyHtml?: string
  /** Short preview snippet (first ~200 chars of plain body). */
  snippet: string
  read: boolean
  labels: string[]             // Gmail labels or IMAP keywords
  hasAttachments: boolean
}

export interface EmailMessageSummary {
  id: string
  folder: string
  threadId?: string
  from: EmailAddress | null
  subject: string
  date: number
  snippet: string
  read: boolean
  labels: string[]
  hasAttachments: boolean
}

// ── IPC + tool argument shapes ──────────────────────────────────────────

export interface SendMessageArgs {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  body: string
  draftId?: string             // when sending a previously-created draft
}

export interface DraftMessageArgs {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  body: string
  inReplyTo?: string
}

export interface ReplyArgs {
  messageId: string
  body: string
  replyAll?: boolean
}

export interface ForwardArgs {
  messageId: string
  to: EmailAddress[]
  body?: string
}

export interface ListMessagesArgs {
  folder?: string
  limit?: number
  query?: string
}

export interface SearchArgs {
  query: string
  folder?: string
  limit?: number
}

// ── Transport-level configuration write shapes ──────────────────────────

export interface SaveImapTransportArgs {
  account: EmailAccount
  imap: ImapConfig
  imapPassword: string
  smtp: SmtpConfig
  smtpPassword: string
}

// ── Status ──────────────────────────────────────────────────────────────

export interface EmailStatus {
  transport: EmailTransportKind | null
  account: EmailAccount
  /** True when the active transport has live credentials available. */
  ready: boolean
  /** When transport === 'google', whether the user is signed in to Google. */
  googleSignedIn: boolean
  lastSyncAt: number | null
}
