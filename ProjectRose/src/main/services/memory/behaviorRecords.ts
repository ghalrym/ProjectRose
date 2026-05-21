import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises'
import { memoryBehaviorRecordsDir } from '../../lib/agentHome'
import type { BehaviorRecord } from '../../../shared/memory'
import { behaviorRecordPath, slugifyForFilename, todayKey, weekdayOf } from './paths'

// Filename grammar: {yyyy-mm-dd}-{slug}.md
const FILENAME_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9_-]+)\.md$/

function assertValidFilename(filename: string): void {
  if (!FILENAME_RE.test(filename)) {
    throw new Error(`Invalid behavior-record filename: ${filename}`)
  }
}

function formatRecord(dateKey: string, decision: string, details: string): string {
  return (
    `# ${dateKey} — ${weekdayOf(dateKey)}\n\n` +
    `## Decision\n${decision.trim()}\n\n` +
    `## Details\n${details.trim()}\n`
  )
}

function parseRecord(filename: string, content: string): BehaviorRecord {
  const fm = filename.match(FILENAME_RE)
  const date = fm ? `${fm[1]}-${fm[2]}-${fm[3]}` : ''
  const slug = fm ? fm[4] : filename.replace(/\.md$/, '')
  const decisionMatch = content.match(/##\s+Decision\s*\n([\s\S]*?)(?:\n##\s+|$)/)
  const detailsMatch = content.match(/##\s+Details\s*\n([\s\S]*?)$/)
  return {
    filename,
    date,
    slug,
    decision: (decisionMatch?.[1] ?? '').trim(),
    details: (detailsMatch?.[1] ?? '').trim()
  }
}

export async function listBehaviorRecords(): Promise<BehaviorRecord[]> {
  let files: string[]
  try { files = await readdir(memoryBehaviorRecordsDir()) } catch { return [] }
  const md = files.filter((f) => f.endsWith('.md') && f !== '.gitkeep')
  const rows: BehaviorRecord[] = []
  for (const file of md) {
    try {
      const content = await readFile(behaviorRecordPath(file), 'utf-8')
      rows.push(parseRecord(file, content))
    } catch { /* skip unreadable */ }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return rows
}

export async function readBehaviorRecord(filename: string): Promise<string | null> {
  assertValidFilename(filename)
  try { return await readFile(behaviorRecordPath(filename), 'utf-8') } catch { return null }
}

export async function writeBehaviorRecord(filename: string, content: string): Promise<void> {
  assertValidFilename(filename)
  await mkdir(memoryBehaviorRecordsDir(), { recursive: true })
  await writeFile(behaviorRecordPath(filename), content, 'utf-8')
}

export async function deleteBehaviorRecord(filename: string): Promise<void> {
  assertValidFilename(filename)
  await unlink(behaviorRecordPath(filename)).catch(() => { /* tolerate */ })
}

async function uniqueFilename(base: string): Promise<string> {
  const existing = new Set(
    (await readdir(memoryBehaviorRecordsDir()).catch(() => [])).filter((f) => f.endsWith('.md'))
  )
  if (!existing.has(`${base}.md`)) return `${base}.md`
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}.md`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}.md`
}

export async function addBehaviorRecord(args: {
  slug: string
  decision: string
  details: string
  dateKey?: string
}): Promise<BehaviorRecord> {
  const dateKey = args.dateKey ?? todayKey()
  const slug = slugifyForFilename(args.slug)
  await mkdir(memoryBehaviorRecordsDir(), { recursive: true })
  const filename = await uniqueFilename(`${dateKey}-${slug}`)
  const content = formatRecord(dateKey, args.decision, args.details)
  await writeFile(behaviorRecordPath(filename), content, 'utf-8')
  return parseRecord(filename, content)
}
