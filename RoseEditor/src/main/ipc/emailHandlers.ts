import { ipcMain } from 'electron'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { IPC } from '../../shared/ipcChannels'
import { readSettings, AppSettings } from './settingsHandlers'

export interface EmailSummary {
  uid: number
  subject: string
  from: string
  date: string
  read: boolean
}

type ImapCfg = Pick<AppSettings, 'imapHost' | 'imapPort' | 'imapUser' | 'imapPassword' | 'imapTLS'>

function makeClient(cfg: ImapCfg): ImapFlow {
  return new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapTLS,
    auth: { user: cfg.imapUser, pass: cfg.imapPassword },
    logger: false
  })
}

async function withClient<T>(cfg: ImapCfg, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = makeClient(cfg)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => {})
  }
}

function describeImapError(err: unknown, cfg: ImapCfg): string {
  if (!(err instanceof Error)) return String(err)

  const e = err as Error & {
    code?: string
    hostname?: string
    responseText?: string
    serverResponseCode?: string
    authenticationFailed?: boolean
  }

  // Network-level errors
  if (e.code === 'ENOTFOUND') {
    return `Host not found: "${e.hostname ?? cfg.imapHost}" — check your IMAP server address`
  }
  if (e.code === 'ECONNREFUSED') {
    return `Connection refused on port ${cfg.imapPort} — check the port number and that the server is reachable`
  }
  if (e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT') {
    return `Connection timed out — server is unreachable or port ${cfg.imapPort} is blocked by a firewall`
  }
  if (e.code === 'ECONNRESET') {
    return `Connection was reset by the server — try enabling TLS or switching ports`
  }
  if (e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || e.code === 'CERT_HAS_EXPIRED') {
    return `TLS certificate error (${e.code}) — try disabling TLS or use port 143`
  }

  // IMAP authentication failure
  if (e.authenticationFailed) {
    const detail = e.responseText ? ` — server said: ${e.responseText}` : ''
    return `Authentication failed${detail}`
  }

  // Combine message + any server response text for everything else
  const parts: string[] = [e.message]
  if (e.responseText && e.responseText !== e.message) parts.push(e.responseText)
  return parts.join(' — ')
}

export function registerEmailHandlers(): void {
  ipcMain.handle(IPC.EMAIL_TEST_CONN, async (): Promise<{ ok: boolean; error?: string }> => {
    const cfg = await readSettings()
    if (!cfg.imapHost || !cfg.imapUser) {
      return { ok: false, error: 'IMAP host and user are required' }
    }
    try {
      await withClient(cfg, async () => {})
      return { ok: true }
    } catch (err) {
      return { ok: false, error: describeImapError(err, cfg) }
    }
  })

  ipcMain.handle(IPC.EMAIL_FETCH_MESSAGES, async (): Promise<EmailSummary[]> => {
    const cfg = await readSettings()
    if (!cfg.imapHost || !cfg.imapUser) return []
    try {
      return await withClient(cfg, async (client) => {
        const lock = await client.getMailboxLock('INBOX')
        try {
          const mbInfo = client.mailbox
          const total = mbInfo ? mbInfo.exists : 0
          if (total === 0) return []
          const start = Math.max(1, total - 49)
          const messages: EmailSummary[] = []
          for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true, uid: true })) {
            messages.push({
              uid: msg.uid,
              subject: msg.envelope?.subject ?? '(no subject)',
              from: msg.envelope?.from?.[0]?.address ?? msg.envelope?.from?.[0]?.name ?? '',
              date: msg.envelope?.date?.toISOString() ?? '',
              read: msg.flags?.has('\\Seen') ?? false
            })
          }
          return messages.reverse()
        } finally {
          lock.release()
        }
      })
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.EMAIL_FETCH_MESSAGE, async (_event, uid: number): Promise<string> => {
    const cfg = await readSettings()
    if (!cfg.imapHost || !cfg.imapUser) return ''
    try {
      return await withClient(cfg, async (client) => {
        const lock = await client.getMailboxLock('INBOX')
        try {
          const { content } = await client.download(String(uid), undefined, { uid: true })
          const parsed = await simpleParser(content)
          return parsed.text ?? ''
        } finally {
          lock.release()
        }
      })
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.EMAIL_DELETE_MESSAGE, async (_event, uid: number): Promise<{ ok: boolean; error?: string }> => {
    const cfg = await readSettings()
    if (!cfg.imapHost || !cfg.imapUser) return { ok: false, error: 'Not configured' }
    try {
      await withClient(cfg, async (client) => {
        const lock = await client.getMailboxLock('INBOX')
        try {
          await client.messageDelete(String(uid), { uid: true })
        } finally {
          lock.release()
        }
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
