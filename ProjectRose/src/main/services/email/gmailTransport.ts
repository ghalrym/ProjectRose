// Gmail API transport for the rose-email built-in. Talks to
// google.gmail({version:'v1', auth: oauthClient}). The OAuth client comes
// from the shared googleAuth module — same refresh token, same scopes — so
// the user only signs in once for both Contacts and Email.
//
// Message IDs are Gmail's native opaque strings; no encoding/decoding
// needed unlike the IMAP path.

import { google, type gmail_v1 } from 'googleapis'

import type {
  DraftMessageArgs,
  EmailAddress,
  EmailFolder,
  EmailMessage,
  EmailMessageSummary,
  ForwardArgs,
  ListMessagesArgs,
  ReplyArgs,
  SearchArgs,
  SendMessageArgs
} from '../../../shared/email'

import { buildAuthedClient } from '../google/googleAuth'
import type { EmailTransportImpl } from './emailTransport'
import { readSettings } from '../settingsService'

async function getGmail(): Promise<gmail_v1.Gmail> {
  const auth = await buildAuthedClient()
  if (!auth) throw new Error('Not signed in to Google.')
  return google.gmail({ version: 'v1', auth })
}

/**
 * Wrap a Gmail API call so the Google-side errors users actually hit surface
 * as actionable messages the renderer can categorize. Each translated
 * message is tagged with a `[email:<category>]` prefix the renderer matches
 * on to pick the right CTA; everything after the prefix is human-readable
 * and may embed an HTTPS URL the UI extracts and renders as a clickable
 * link.
 *
 * Categories:
 * - `scope-missing` — user signed in to Google before `gmail.modify` was in
 *   GOOGLE_SCOPES; fix is to re-authorize (forces fresh consent).
 * - `api-disabled` — the user's Google Cloud project doesn't have the
 *   Gmail API enabled; fix is to enable it via the URL Google embeds in
 *   the error (we pass it through verbatim).
 */
export async function callGmail<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isInsufficientScope(err)) {
      throw new Error('[email:scope-missing] Google sign-in does not include Gmail. Re-authorize Google to grant the Gmail scope.')
    }
    if (isAccessNotConfigured(err)) {
      const url = extractEnableUrl(err) ?? 'https://console.developers.google.com/apis/library/gmail.googleapis.com'
      throw new Error(`[email:api-disabled] The Gmail API is not enabled for your Google Cloud project. Enable it at ${url} then retry.`)
    }
    throw err
  }
}

function gaxiosReasons(err: unknown): string[] {
  if (!err || typeof err !== 'object') return []
  const e = err as { errors?: Array<{ reason?: string }> }
  return (e.errors ?? []).map((r) => r.reason ?? '').filter(Boolean)
}

function isInsufficientScope(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: number; status?: number; message?: string }
  if (e.code !== 403 && e.status !== 403) return false
  if (gaxiosReasons(err).includes('insufficientPermissions')) return true
  if (typeof e.message === 'string' && /insufficient/i.test(e.message)) return true
  return false
}

function isAccessNotConfigured(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: number; status?: number; message?: string }
  if (e.code !== 403 && e.status !== 403) return false
  if (gaxiosReasons(err).includes('accessNotConfigured')) return true
  if (typeof e.message === 'string' && /api has not been used|accessNotConfigured/i.test(e.message)) return true
  return false
}

function extractEnableUrl(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { message?: string; errors?: Array<{ message?: string }> }
  const haystack = `${e.message ?? ''}\n${(e.errors ?? []).map((r) => r.message ?? '').join('\n')}`
  const m = haystack.match(/https:\/\/console\.developers\.google\.com\/[^\s]+/)
  return m?.[0] ?? null
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): Buffer {
  let s = input.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

function parseAddressList(raw: string): EmailAddress[] {
  if (!raw) return []
  const out: EmailAddress[] = []
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/) ?? trimmed.match(/^(.+)$/)
    if (!m) continue
    if (m.length === 3) {
      const name = m[1]?.trim() || undefined
      out.push({ address: m[2].trim(), name })
    } else {
      out.push({ address: trimmed })
    }
  }
  return out
}

function parseFirstAddress(raw: string): EmailAddress | null {
  const list = parseAddressList(raw)
  return list[0] ?? null
}

function snippetOf(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function walkParts(payload: gmail_v1.Schema$MessagePart | undefined): {
  textBody: string
  htmlBody: string | undefined
  hasAttachments: boolean
} {
  let text = ''
  let html: string | undefined
  let hasAttachments = false
  const visit = (part: gmail_v1.Schema$MessagePart | undefined): void => {
    if (!part) return
    const mime = (part.mimeType ?? '').toLowerCase()
    if (part.filename && part.filename.length > 0) {
      hasAttachments = true
    }
    if (mime === 'text/plain' && part.body?.data) {
      text += base64UrlDecode(part.body.data).toString('utf-8')
    } else if (mime === 'text/html' && part.body?.data) {
      html = (html ?? '') + base64UrlDecode(part.body.data).toString('utf-8')
    }
    for (const p of part.parts ?? []) visit(p)
  }
  visit(payload)
  return { textBody: text, htmlBody: html, hasAttachments }
}

function toSummary(msg: gmail_v1.Schema$Message): EmailMessageSummary {
  const headers = msg.payload?.headers
  const from = parseFirstAddress(headerValue(headers, 'From'))
  const subject = headerValue(headers, 'Subject')
  const dateHeader = headerValue(headers, 'Date')
  const date = dateHeader ? Date.parse(dateHeader) : Number(msg.internalDate ?? Date.now())
  const labelIds = msg.labelIds ?? []
  return {
    id: msg.id ?? '',
    folder: labelIds.find((l) => l === 'INBOX') ?? labelIds[0] ?? 'INBOX',
    threadId: msg.threadId ?? undefined,
    from,
    subject,
    date,
    snippet: snippetOf(msg.snippet ?? ''),
    read: !labelIds.includes('UNREAD'),
    labels: labelIds,
    hasAttachments: false
  }
}

function toFull(msg: gmail_v1.Schema$Message): EmailMessage {
  const headers = msg.payload?.headers
  const from = parseFirstAddress(headerValue(headers, 'From'))
  const to = parseAddressList(headerValue(headers, 'To'))
  const cc = parseAddressList(headerValue(headers, 'Cc'))
  const bcc = parseAddressList(headerValue(headers, 'Bcc'))
  const subject = headerValue(headers, 'Subject')
  const dateHeader = headerValue(headers, 'Date')
  const date = dateHeader ? Date.parse(dateHeader) : Number(msg.internalDate ?? Date.now())
  const { textBody, htmlBody, hasAttachments } = walkParts(msg.payload)
  const labelIds = msg.labelIds ?? []
  return {
    id: msg.id ?? '',
    folder: labelIds.find((l) => l === 'INBOX') ?? labelIds[0] ?? 'INBOX',
    threadId: msg.threadId ?? undefined,
    from,
    to,
    cc,
    bcc,
    subject,
    date,
    body: textBody || (htmlBody ? stripHtml(htmlBody) : ''),
    bodyHtml: htmlBody,
    snippet: snippetOf(textBody || msg.snippet || ''),
    read: !labelIds.includes('UNREAD'),
    labels: labelIds,
    hasAttachments
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
}

function formatAddress(a: EmailAddress): string {
  return a.name ? `"${a.name}" <${a.address}>` : a.address
}

function buildRfc822(args: {
  from: string
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  body: string
  inReplyTo?: string
}): string {
  const lines: string[] = []
  lines.push(`From: ${args.from}`)
  lines.push(`To: ${args.to.map(formatAddress).join(', ')}`)
  if (args.cc && args.cc.length) lines.push(`Cc: ${args.cc.map(formatAddress).join(', ')}`)
  if (args.bcc && args.bcc.length) lines.push(`Bcc: ${args.bcc.map(formatAddress).join(', ')}`)
  lines.push(`Subject: ${args.subject}`)
  if (args.inReplyTo) {
    lines.push(`In-Reply-To: ${args.inReplyTo}`)
    lines.push(`References: ${args.inReplyTo}`)
  }
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/plain; charset=UTF-8')
  lines.push('')
  lines.push(args.body)
  return lines.join('\r\n')
}

export function createGmailTransport(): EmailTransportImpl {
  return {
    kind: 'google',

    async listFolders(): Promise<EmailFolder[]> {
      const gmail = await getGmail()
      const res = await callGmail(() => gmail.users.labels.list({ userId: 'me' }))
      const labels = res.data.labels ?? []
      const out: EmailFolder[] = []
      for (const l of labels) {
        if (!l.id || !l.name) continue
        out.push({ id: l.id, name: l.name })
      }
      return out
    },

    async listMessages({ folder, limit, query }: ListMessagesArgs): Promise<EmailMessageSummary[]> {
      const gmail = await getGmail()
      const labelIds = folder ? [folder] : ['INBOX']
      const res = await callGmail(() => gmail.users.messages.list({
        userId: 'me',
        labelIds,
        q: query,
        maxResults: limit ?? 50
      }))
      const refs = res.data.messages ?? []
      const out: EmailMessageSummary[] = []
      for (const ref of refs) {
        if (!ref.id) continue
        const full = await callGmail(() => gmail.users.messages.get({
          userId: 'me',
          id: ref.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        }))
        out.push(toSummary(full.data))
      }
      return out
    },

    async search({ query, folder, limit }: SearchArgs): Promise<EmailMessageSummary[]> {
      return this.listMessages({ folder, limit, query })
    },

    async getMessage(messageId: string): Promise<EmailMessage> {
      const gmail = await getGmail()
      const res = await callGmail(() => gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      }))
      return toFull(res.data)
    },

    async createDraft(args: DraftMessageArgs): Promise<{ draftId: string }> {
      const gmail = await getGmail()
      const settings = await readSettings()
      const from = settings.email.account.address ?? ''
      const raw = base64UrlEncode(buildRfc822({
        from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        body: args.body,
        inReplyTo: args.inReplyTo
      }))
      const res = await callGmail(() => gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } }
      }))
      return { draftId: res.data.id ?? '' }
    },

    async sendMessage(args: SendMessageArgs): Promise<{ messageId: string }> {
      const gmail = await getGmail()
      const settings = await readSettings()
      const from = settings.email.account.address ?? ''
      if (args.draftId) {
        const res = await callGmail(() => gmail.users.drafts.send({
          userId: 'me',
          requestBody: { id: args.draftId }
        }))
        return { messageId: res.data.id ?? '' }
      }
      const raw = base64UrlEncode(buildRfc822({
        from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        body: args.body
      }))
      const res = await callGmail(() => gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw }
      }))
      return { messageId: res.data.id ?? '' }
    },

    async reply(args: ReplyArgs): Promise<{ messageId: string }> {
      const original = await this.getMessage(args.messageId)
      const subject = original.subject.toLowerCase().startsWith('re:') ? original.subject : `Re: ${original.subject}`
      const recipients: EmailAddress[] = []
      if (original.from) recipients.push(original.from)
      if (args.replyAll) {
        for (const a of original.to) recipients.push(a)
        for (const a of original.cc) recipients.push(a)
      }
      return this.sendMessage({ to: recipients, subject, body: args.body })
    },

    async forward(args: ForwardArgs): Promise<{ messageId: string }> {
      const original = await this.getMessage(args.messageId)
      const subject = original.subject.toLowerCase().startsWith('fwd:') ? original.subject : `Fwd: ${original.subject}`
      const body = (args.body ?? '') + `\n\n--- Forwarded message ---\nFrom: ${original.from?.address ?? ''}\nSubject: ${original.subject}\nDate: ${new Date(original.date).toISOString()}\n\n${original.body}`
      return this.sendMessage({ to: args.to, subject, body })
    },

    async markRead(messageId: string, read: boolean): Promise<void> {
      const gmail = await getGmail()
      await callGmail(() => gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }
      }))
    },

    async archive(messageId: string): Promise<void> {
      const gmail = await getGmail()
      // Archive in Gmail = remove from INBOX. The message stays in All Mail.
      await callGmail(() => gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['INBOX'] }
      }))
    },

    async move(messageId: string, folder: string): Promise<void> {
      const gmail = await getGmail()
      // In Gmail there are no folders; moving = swapping a label. We add the
      // target label and remove INBOX so the message effectively appears only
      // in the chosen label.
      await callGmail(() => gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { addLabelIds: [folder], removeLabelIds: ['INBOX'] }
      }))
    },

    async label(messageId: string, label: string, add: boolean): Promise<void> {
      const gmail = await getGmail()
      await callGmail(() => gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: add ? { addLabelIds: [label] } : { removeLabelIds: [label] }
      }))
    },

    async deleteMessage(messageId: string): Promise<void> {
      const gmail = await getGmail()
      await callGmail(() => gmail.users.messages.trash({ userId: 'me', id: messageId }))
    }
  }
}
