import type { Message } from '../../shared/roseModelTypes'
import { runAgentOnce } from './aiService'

export interface AgentSession {
  send: (text: string) => Promise<string>
  close: () => void
}

const openSessions = new Map<string, Set<AgentSession>>()

export function create({
  rootPath,
  systemPrompt,
  ownerKey
}: {
  rootPath: string
  systemPrompt: string
  ownerKey: string
}): AgentSession {
  const history: Message[] = []
  let inflight = false
  let closed = false

  const session: AgentSession = {
    async send(text: string): Promise<string> {
      if (closed) throw new Error('AgentSession is closed')
      if (inflight) throw new Error('AgentSession is busy — await the previous send before sending again')
      inflight = true
      try {
        history.push({ role: 'user', content: text })
        const { content } = await runAgentOnce(history, rootPath, systemPrompt)
        history.push({ role: 'assistant', content })
        return content
      } finally {
        inflight = false
      }
    },
    close(): void {
      if (closed) return
      closed = true
      history.length = 0
      openSessions.get(ownerKey)?.delete(session)
    }
  }

  let bucket = openSessions.get(ownerKey)
  if (!bucket) {
    bucket = new Set()
    openSessions.set(ownerKey, bucket)
  }
  bucket.add(session)

  return session
}

export function closeAllForOwner(ownerKey: string): void {
  const bucket = openSessions.get(ownerKey)
  if (!bucket) return
  for (const session of bucket) {
    try { session.close() } catch { /* ignore */ }
  }
  openSessions.delete(ownerKey)
}
