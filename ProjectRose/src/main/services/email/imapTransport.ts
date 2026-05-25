// IMAP/SMTP transport for the rose-email built-in. Uses imapflow for the
// IMAP side and nodemailer for outbound SMTP. Per-call connect/disconnect —
// no long-lived sockets in main.
//
// Message IDs are encoded as `${mailboxPath}|${uid}` (split on the LAST '|')
// so the agent and renderer pass opaque strings around without having to
// know the IMAP UID/mailbox structure.

import log from 'electron-log/main'
import { ImapFlow, type FetchMessageObject, type ListResponse, type MailboxLockObject } from 'imapflow'
import nodemailer, { type Transporter } from 'nodemailer'
import { simpleParser, type ParsedMail } from 'mailparser'

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

import { readSettings } from '../settingsService'
import { readImapPasswords } from './imapCredentialsStore'
import type { EmailTransportImpl } from './emailTransport'

const ID_SEP = '|'

function encodeId(mailbox: string, uid: number): string {
  return `${mailbox}${ID_SEP}${uid}`
}

function decodeId(id: string): { mailbox: string; uid: number } {
  const idx = id.lastIndexOf(ID_SEP)
  if (idx === -1) throw new Error(`Invalid IMAP message id: ${id}`)
  const mailbox = id.slice(0, idx)
  const uid = Number.parseInt(id.slice(idx + 1), 10)
  if (!Number.isFinite(uid)) throw new Error(`Invalid IMAP message id (uid): ${id}`)
  return { mailbox, uid }
}

async function withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const s = await readSettings()
  const imap = s.email?.imap
  if (!imap) throw new Error('IMAP config missing.')
  const pwds = await readImapPasswords()
  if (!pwds) throw new Error('IMAP password not available.')
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.username, pass: pwds.imapPassword },
    logger: false
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    try { await client.logout() } catch { /* tolerate */ }
  }
}

async function withMailboxLock<T>(
  client: ImapFlow,
  mailbox: string,
  fn: () => Promise<T>
): Promise<T> {
  const lock: MailboxLockObject = await client.getMailboxLock(mailbox)
  try {
    return await fn()
  } finally {
    lock.release()
  }
}

async function buildSmtpTransporter(): Promise<Transporter> {
  const s = await readSettings()
  const smtp = s.email?.smtp
  if (!smtp) throw new Error('SMTP config missing.')
  const pwds = await readImapPasswords()
  if (!pwds) throw new Error('SMTP password not available.')
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.username, pass: pwds.smtpPassword }
  })
}

// Open a short-lived IMAP connection and immediately close it. Used by the
// settings-snapshot tool to answer "does the user's IMAP setup actually work
// right now?" without leaking the password.
export async function verifyImapConnection(): Promise<void> {
  const s = await readSettings()
  const imap = s.email?.imap
  if (!imap) throw new Error('IMAP config missing.')
  const pwds = await readImapPasswords()
  if (!pwds) throw new Error('IMAP password not available.')
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.username, pass: pwds.imapPassword },
    logger: false
  })
  try {
    await client.connect()
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }
}

// Open an SMTP transporter and call nodemailer's verify() — performs the
// connect + STARTTLS + auth handshake without sending mail. Same purpose as
// verifyImapConnection for the outbound side.
export async function verifySmtpConnection(): Promise<void> {
  const transporter = await buildSmtpTransporter()
  try {
    await transporter.verify()
  } finally {
    try { transporter.close() } catch { /* ignore */ }
  }
}

function snippetFrom(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function addrToEmailAddress(addr: ParsedMail['from'] | undefined | null): EmailAddress | null {
  if (!addr) return null
  const list = Array.isArray(addr) ? addr : [addr]
  const first = list[0]?.value?.[0]
  if (!first?.address) return null
  return { address: first.address, name: first.name || undefined }
}

function addrsToEmailAddresses(addr: ParsedMail['to'] | undefined | null): EmailAddress[] {
  if (!addr) return []
  const list = Array.isArray(addr) ? addr : [addr]
  const out: EmailAddress[] = []
  for (const a of list) {
    for (const v of a?.value ?? []) {
      if (v.address) out.push({ address: v.address, name: v.name || undefined })
    }
  }
  return out
}

function summariseFetch(mailbox: string, fetched: FetchMessageObject): EmailMessageSummary {
  const env = fetched.envelope
  const fromAddr = env?.from?.[0]
  const subject = env?.subject ?? ''
  const date = env?.date instanceof Date ? env.date.getTime() : (env?.date ? Date.parse(env.date as string) : Date.now())
  const flagSet = fetched.flags ?? new Set<string>()
  return {
    id: encodeId(mailbox, Number(fetched.uid)),
    folder: mailbox,
    from: fromAddr?.address ? { address: fromAddr.address, name: fromAddr.name || undefined } : null,
    subject,
    date,
    snippet: '',
    read: flagSet.has('\\Seen'),
    labels: [...flagSet].filter((f) => !f.startsWith('\\')),
    hasAttachments: false
  }
}

function fullFromParsed(mailbox: string, uid: number, parsed: ParsedMail, flagSet: Set<string>): EmailMessage {
  const body = parsed.text ?? ''
  return {
    id: encodeId(mailbox, uid),
    folder: mailbox,
    from: addrToEmailAddress(parsed.from),
    to: addrsToEmailAddresses(parsed.to),
    cc: addrsToEmailAddresses(parsed.cc),
    bcc: addrsToEmailAddresses(parsed.bcc),
    subject: parsed.subject ?? '',
    date: parsed.date ? parsed.date.getTime() : Date.now(),
    body,
    bodyHtml: typeof parsed.html === 'string' ? parsed.html : undefined,
    snippet: snippetFrom(body),
    read: flagSet.has('\\Seen'),
    labels: [...flagSet].filter((f) => !f.startsWith('\\')),
    hasAttachments: (parsed.attachments?.length ?? 0) > 0
  }
}

// Standard mailbox lookups. IMAP servers vary on naming — we prefer the
// \Drafts / \Sent / \Trash / \Archive special-use flags, then fall back to
// common names.

async function findMailboxWithSpecialUse(client: ImapFlow, flag: string, fallbacks: string[]): Promise<string | null> {
  const list = await client.list()
  for (const m of list) {
    if ((m.specialUse ?? '').toLowerCase() === flag.toLowerCase()) return m.path
  }
  for (const m of list) {
    if (fallbacks.some((f) => m.name.toLowerCase() === f.toLowerCase())) return m.path
  }
  return null
}

export function createImapTransport(): EmailTransportImpl {
  return {
    kind: 'imap',

    async listFolders(): Promise<EmailFolder[]> {
      return withImap(async (client) => {
        const list: ListResponse[] = await client.list()
        const out: EmailFolder[] = []
        for (const m of list) {
          out.push({ id: m.path, name: m.name })
        }
        return out
      })
    },

    async listMessages({ folder, limit, query }: ListMessagesArgs): Promise<EmailMessageSummary[]> {
      const mailbox = folder ?? 'INBOX'
      const max = limit ?? 50
      return withImap(async (client) => {
        return withMailboxLock(client, mailbox, async () => {
          const seq = query
            ? await client.search({ body: query }, { uid: true })
            : await client.search({ all: true }, { uid: true })
          if (!seq || seq.length === 0) return []
          const recent = seq.slice(-max).reverse()
          const out: EmailMessageSummary[] = []
          for await (const msg of client.fetch(recent, { envelope: true, flags: true }, { uid: true })) {
            out.push(summariseFetch(mailbox, msg))
          }
          return out
        })
      })
    },

    async search({ query, folder, limit }: SearchArgs): Promise<EmailMessageSummary[]> {
      return this.listMessages({ folder, limit, query })
    },

    async getMessage(messageId: string): Promise<EmailMessage> {
      const { mailbox, uid } = decodeId(messageId)
      return withImap(async (client) => {
        return withMailboxLock(client, mailbox, async () => {
          const iter = client.fetch([uid], { source: true, flags: true }, { uid: true })
          for await (const msg of iter) {
            const raw = msg.source
            if (!raw) throw new Error(`Message ${messageId} returned no source.`)
            const parsed = await simpleParser(raw)
            return fullFromParsed(mailbox, uid, parsed, msg.flags ?? new Set())
          }
          throw new Error(`Message ${messageId} not found.`)
        })
      })
    },

    async createDraft(args: DraftMessageArgs): Promise<{ draftId: string }> {
      const transporter = await buildSmtpTransporter()
      const rawInfo = await transporter.sendMail({
        from: (await readSettings()).email.account.address ?? undefined,
        to: args.to.map(formatAddress),
        cc: args.cc?.map(formatAddress),
        bcc: args.bcc?.map(formatAddress),
        subject: args.subject,
        text: args.body,
        inReplyTo: args.inReplyTo
      })
      // nodemailer can produce the raw MIME via streamTransport, but for the
      // draft we just re-fetch from the SMTP-buffered raw if available. As a
      // pragmatic fallback we APPEND a minimal MIME body to the Drafts box.
      const raw = (rawInfo as { message?: Buffer | string }).message
      const rawBytes = typeof raw === 'string' ? Buffer.from(raw) : (raw ?? Buffer.from(`Subject: ${args.subject}\r\n\r\n${args.body}`))
      return withImap(async (client) => {
        const drafts = await findMailboxWithSpecialUse(client, '\\Drafts', ['Drafts', 'INBOX.Drafts'])
        if (!drafts) throw new Error('No Drafts mailbox available.')
        const res = await client.append(drafts, rawBytes, ['\\Draft'])
        const uid = res && typeof res === 'object' && 'uid' in res ? Number(res.uid) : 0
        return { draftId: encodeId(drafts, uid) }
      })
    },

    async sendMessage(args: SendMessageArgs): Promise<{ messageId: string }> {
      const transporter = await buildSmtpTransporter()
      const settings = await readSettings()
      const from = settings.email.account.address ?? undefined
      const info = await transporter.sendMail({
        from,
        to: args.to.map(formatAddress),
        cc: args.cc?.map(formatAddress),
        bcc: args.bcc?.map(formatAddress),
        subject: args.subject,
        text: args.body
      })
      const sentMessageId = info.messageId ?? `local-${Date.now()}`
      // Append to Sent for visibility. Tolerate failure — the message did go out.
      try {
        const raw = (info as { message?: Buffer | string }).message
        const rawBytes = typeof raw === 'string' ? Buffer.from(raw) : raw
        if (rawBytes) {
          await withImap(async (client) => {
            const sent = await findMailboxWithSpecialUse(client, '\\Sent', ['Sent', 'Sent Items', 'INBOX.Sent'])
            if (sent) await client.append(sent, rawBytes, ['\\Seen'])
          })
        }
      } catch (err) {
        log.warn('[email] failed to append sent message to Sent mailbox', err)
      }
      return { messageId: sentMessageId }
    },

    async reply(args: ReplyArgs): Promise<{ messageId: string }> {
      const original = await this.getMessage(args.messageId)
      const subject = original.subject.toLowerCase().startsWith('re:') ? original.subject : `Re: ${original.subject}`
      const recipients: EmailAddress[] = []
      if (original.from) recipients.push(original.from)
      if (args.replyAll) {
        for (const a of original.to) if (a.address) recipients.push(a)
        for (const a of original.cc) if (a.address) recipients.push(a)
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
      const { mailbox, uid } = decodeId(messageId)
      await withImap(async (client) => {
        await withMailboxLock(client, mailbox, async () => {
          if (read) await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true })
          else await client.messageFlagsRemove([uid], ['\\Seen'], { uid: true })
        })
      })
    },

    async archive(messageId: string): Promise<void> {
      const { mailbox, uid } = decodeId(messageId)
      await withImap(async (client) => {
        const archive = await findMailboxWithSpecialUse(client, '\\Archive', ['Archive', 'All Mail', '[Gmail]/All Mail'])
        if (!archive) throw new Error('No Archive mailbox available.')
        await withMailboxLock(client, mailbox, async () => {
          await client.messageMove([uid], archive, { uid: true })
        })
      })
    },

    async move(messageId: string, folder: string): Promise<void> {
      const { mailbox, uid } = decodeId(messageId)
      await withImap(async (client) => {
        await withMailboxLock(client, mailbox, async () => {
          await client.messageMove([uid], folder, { uid: true })
        })
      })
    },

    async label(messageId: string, label: string, add: boolean): Promise<void> {
      const { mailbox, uid } = decodeId(messageId)
      await withImap(async (client) => {
        await withMailboxLock(client, mailbox, async () => {
          if (add) await client.messageFlagsAdd([uid], [label], { uid: true })
          else await client.messageFlagsRemove([uid], [label], { uid: true })
        })
      })
    },

    async deleteMessage(messageId: string): Promise<void> {
      const { mailbox, uid } = decodeId(messageId)
      await withImap(async (client) => {
        const trash = await findMailboxWithSpecialUse(client, '\\Trash', ['Trash', 'Deleted', 'Deleted Items', '[Gmail]/Trash'])
        if (!trash) throw new Error('No Trash mailbox available.')
        await withMailboxLock(client, mailbox, async () => {
          await client.messageMove([uid], trash, { uid: true })
        })
      })
    }
  }
}

function formatAddress(a: EmailAddress): string {
  return a.name ? `"${a.name}" <${a.address}>` : a.address
}
