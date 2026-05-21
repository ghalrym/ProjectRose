import { appendFile, mkdir, readFile } from 'fs/promises'
import { dirname } from 'path'
import { memoryConversationsDir } from '../../lib/agentHome'
import type { ConversationLogEntry } from '../../../shared/memory'
import { conversationLogPath, todayKey, ymdKey } from './paths'

// Per-day JSONL. Only persists the final user/assistant content per turn —
// tool calls, thoughts, and streaming deltas are intentionally excluded so
// the file stays a clean reading log and the diary's input prompt stays
// small.

const MAX_INLINE_CONTENT = 8_000

function truncate(text: string): string {
  if (text.length <= MAX_INLINE_CONTENT) return text
  return text.slice(0, MAX_INLINE_CONTENT) + `\n…[truncated ${text.length - MAX_INLINE_CONTENT} chars]`
}

export async function appendConversationEntry(entry: ConversationLogEntry): Promise<void> {
  try {
    await mkdir(memoryConversationsDir(), { recursive: true })
  } catch { /* tolerate */ }
  const path = conversationLogPath(ymdKey(new Date(entry.timestamp)))
  await mkdir(dirname(path), { recursive: true })
  const safe: ConversationLogEntry = { ...entry, content: truncate(entry.content) }
  await appendFile(path, JSON.stringify(safe) + '\n', 'utf-8').catch(() => { /* tolerate */ })
}

export async function logUserMessage(args: {
  sessionId: string
  rootPath: string
  content: string
}): Promise<void> {
  await appendConversationEntry({
    timestamp: Date.now(),
    sessionId: args.sessionId,
    rootPath: args.rootPath,
    role: 'user',
    content: args.content
  })
}

export async function logAssistantMessage(args: {
  sessionId: string
  rootPath: string
  content: string
}): Promise<void> {
  await appendConversationEntry({
    timestamp: Date.now(),
    sessionId: args.sessionId,
    rootPath: args.rootPath,
    role: 'assistant',
    content: args.content
  })
}

export async function readConversationLog(dateKey: string): Promise<ConversationLogEntry[]> {
  const path = conversationLogPath(dateKey)
  let raw: string
  try { raw = await readFile(path, 'utf-8') } catch { return [] }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const out: ConversationLogEntry[] = []
  for (const line of lines) {
    try { out.push(JSON.parse(line) as ConversationLogEntry) } catch { /* skip */ }
  }
  return out
}

export async function readTodayConversationLog(): Promise<ConversationLogEntry[]> {
  return readConversationLog(todayKey())
}
