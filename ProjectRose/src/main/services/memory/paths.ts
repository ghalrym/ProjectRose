import { join } from 'path'
import {
  memoryDiaryDir,
  memoryBehaviorRecordsDir,
  memoryContactDir,
  memoryConversationsDir,
  memoryAgentActivityDir,
  memoryCalendarDir
} from '../../lib/agentHome'

// All memory paths live under ~/.rose/memory/. These helpers wrap the
// agent-home base paths so callers stay symmetrical with the rest of the
// codebase (compare prPath for workspace-scoped data).

export function diaryPath(date: { year: string; month: string; day: string }): string {
  return join(memoryDiaryDir(), date.year, date.month, `${date.day}.md`)
}

export function diaryMonthDir(year: string, month: string): string {
  return join(memoryDiaryDir(), year, month)
}

export function diaryYearDir(year: string): string {
  return join(memoryDiaryDir(), year)
}

export function behaviorRecordPath(filename: string): string {
  return join(memoryBehaviorRecordsDir(), filename)
}

export function contactPath(entity: string): string {
  return join(memoryContactDir(), `${entity}.md`)
}

export function conversationLogPath(dateKey: string): string {
  return join(memoryConversationsDir(), `${dateKey}.jsonl`)
}

export function activityLogPath(dateKey: string): string {
  return join(memoryAgentActivityDir(), `${dateKey}.jsonl`)
}

export function calendarYearDir(year: string): string {
  return join(memoryCalendarDir(), year)
}

export function calendarMonthDir(year: string, month: string): string {
  return join(memoryCalendarDir(), year, month)
}

export function calendarDayDir(year: string, month: string, day: string): string {
  return join(memoryCalendarDir(), year, month, day)
}

export function calendarEventPath(date: { year: string; month: string; day: string }, slug: string): string {
  return join(memoryCalendarDir(), date.year, date.month, date.day, `${slug}.md`)
}

// yyyy-mm-dd today key in local time. Memory keys by the user's local day,
// not UTC — the diary at 21:00 local is what the user thinks of as "today".
export function todayKey(now: Date = new Date()): string {
  return ymdKey(now)
}

export function ymdKey(d: Date): string {
  const y = String(d.getFullYear())
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function splitYmd(key: string): { year: string; month: string; day: string } | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { year: m[1], month: m[2], day: m[3] }
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayOf(key: string): string {
  const parts = splitYmd(key)
  if (!parts) return ''
  const d = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  return WEEKDAY[d.getDay()]
}

// Filenames have to survive a round-trip through both Windows and POSIX
// filesystems. Strip the obvious illegals and collapse whitespace runs into
// dashes. Empty inputs become 'untitled' so we never emit '.md'.
export function slugifyForFilename(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return cleaned || 'untitled'
}

// Allow [a-z0-9_.-] only (case-insensitive). Used to guard contact entity
// names since they round-trip through user-supplied content.
export function safeEntityName(entity: string): string {
  return entity.trim().replace(/[^A-Za-z0-9_. -]+/g, '').replace(/\s+/g, ' ').slice(0, 100)
}
