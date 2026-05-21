import { appendFile, mkdir, readFile } from 'fs/promises'
import { dirname } from 'path'
import { memoryAgentActivityDir } from '../../lib/agentHome'
import type { ActivityKind, ActivityLogEntry } from '../../../shared/memory'
import { activityLogPath, todayKey, ymdKey } from './paths'

// Per-day JSONL. Captures extension-driven agent activity:
//   - agent-handle-open      (extension calls openAgentSession)
//   - agent-handle-message   (extension calls handle.send())
//   - detached-run-start     (extension calls runBackgroundAgent)
//   - detached-run-end       (the resulting promise settles, success or fail)
//
// Summary is a short human-readable line; content fields are clipped to keep
// the log readable when extensions chat in a tight loop.

const MAX_SUMMARY = 500

function truncate(text: string): string {
  return text.length <= MAX_SUMMARY ? text : text.slice(0, MAX_SUMMARY) + '…'
}

export async function appendActivityEntry(entry: ActivityLogEntry): Promise<void> {
  try {
    await mkdir(memoryAgentActivityDir(), { recursive: true })
  } catch { /* tolerate */ }
  const path = activityLogPath(ymdKey(new Date(entry.timestamp)))
  await mkdir(dirname(path), { recursive: true })
  const safe: ActivityLogEntry = { ...entry, summary: truncate(entry.summary) }
  await appendFile(path, JSON.stringify(safe) + '\n', 'utf-8').catch(() => { /* tolerate */ })
}

export async function logActivity(
  extensionId: string,
  kind: ActivityKind,
  summary: string
): Promise<void> {
  await appendActivityEntry({
    timestamp: Date.now(),
    extensionId,
    kind,
    summary
  })
}

export async function readActivityLog(dateKey: string): Promise<ActivityLogEntry[]> {
  const path = activityLogPath(dateKey)
  let raw: string
  try { raw = await readFile(path, 'utf-8') } catch { return [] }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const out: ActivityLogEntry[] = []
  for (const line of lines) {
    try { out.push(JSON.parse(line) as ActivityLogEntry) } catch { /* skip */ }
  }
  return out
}

export async function readTodayActivityLog(): Promise<ActivityLogEntry[]> {
  return readActivityLog(todayKey())
}
