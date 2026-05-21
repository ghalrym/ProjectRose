import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { dirname } from 'path'
import { memoryDiaryDir } from '../../lib/agentHome'
import type { DiaryIndexRow } from '../../../shared/memory'
import {
  diaryMonthDir,
  diaryPath,
  diaryYearDir,
  splitYmd,
  todayKey,
  weekdayOf
} from './paths'

// ─── Read / write ────────────────────────────────────────────────────────

export async function readDiary(dateKey: string): Promise<string | null> {
  const parts = splitYmd(dateKey)
  if (!parts) return null
  try {
    return await readFile(diaryPath(parts), 'utf-8')
  } catch {
    return null
  }
}

export async function writeDiary(dateKey: string, content: string): Promise<void> {
  const parts = splitYmd(dateKey)
  if (!parts) throw new Error(`Invalid date key: ${dateKey}`)
  const file = diaryPath(parts)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf-8')
}

export async function deleteDiary(dateKey: string): Promise<void> {
  const parts = splitYmd(dateKey)
  if (!parts) return
  await unlink(diaryPath(parts)).catch(() => { /* tolerate */ })
}

export async function diaryExists(dateKey: string): Promise<boolean> {
  return (await readDiary(dateKey)) !== null
}

// ─── Index ────────────────────────────────────────────────────────────────

async function safeReaddir(dir: string): Promise<string[]> {
  try { return await readdir(dir) } catch { return [] }
}

/**
 * Walk ~/.rose/memory/diary/{yyyy}/{mm}/{dd}.md and return rows sorted by
 * date descending.
 */
export async function listDiaryIndex(): Promise<DiaryIndexRow[]> {
  const rows: DiaryIndexRow[] = []
  const root = memoryDiaryDir()
  const years = (await safeReaddir(root)).filter((y) => /^\d{4}$/.test(y))
  for (const year of years) {
    const months = (await safeReaddir(diaryYearDir(year))).filter((m) => /^\d{2}$/.test(m))
    for (const month of months) {
      const days = await safeReaddir(diaryMonthDir(year, month))
      for (const file of days) {
        const m = file.match(/^(\d{2})\.md$/)
        if (!m) continue
        const dateKey = `${year}-${month}-${m[1]}`
        rows.push({ date: dateKey, path: diaryPath({ year, month, day: m[1] }) })
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return rows
}

// ─── Default scaffold ─────────────────────────────────────────────────────

export function defaultDiaryHeader(dateKey: string): string {
  const wd = weekdayOf(dateKey)
  return `# ${dateKey} — ${wd}\n\n`
}

export function emptyDiaryPlaceholder(dateKey: string): string {
  return (
    `${defaultDiaryHeader(dateKey)}` +
    `_Nothing was recorded for this day._\n` +
    `\n## Events\n\n## Reflection\n\n## Outlook\n`
  )
}

export function todaysDateKey(): string {
  return todayKey()
}
