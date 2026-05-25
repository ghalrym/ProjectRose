// Host tool handlers for the memory subsystem. Same signature as
// toolHandlers.ts — (input, projectRoot, toolCtx) => Promise<string> — so
// they can be wrapped by `wrapExecute` and registered in buildCoreTools.

import {
  addBehaviorRecord,
  deleteBehaviorRecord,
  listBehaviorRecords,
  readBehaviorRecord
} from './behaviorRecords'
import {
  addContactNote,
  newContact,
  readContact,
  removeContactNote,
  searchContacts,
  setContactKind
} from './contacts'
import { CONTACT_KINDS, type ContactKind } from '../../../shared/memory'
import {
  listDiaryIndex,
  readDiary,
  writeDiary,
  diaryExists,
  todaysDateKey
} from './diary'
import { ymdKey } from './paths'

// Helper to coerce string args.
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

// ─── Diary ───────────────────────────────────────────────────────────────

export async function handleMemoryReadDiary(input: Record<string, unknown>): Promise<string> {
  const date = asString(input.date)
  if (!date) return 'Missing `date` (yyyy-mm-dd).'
  const content = await readDiary(date)
  return content ?? `No diary entry exists for ${date}.`
}

export async function handleMemoryListDiary(input: Record<string, unknown>): Promise<string> {
  const from = asString(input.from)
  const to = asString(input.to)
  const rows = await listDiaryIndex()
  const filtered = rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
  if (filtered.length === 0) return 'No diary entries found.'
  return filtered.map((r) => r.date).join('\n')
}

export async function handleMemoryWriteDiary(input: Record<string, unknown>): Promise<string> {
  const date = asString(input.date) || todaysDateKey()
  const content = asString(input.content)
  if (!content.trim()) return 'Missing `content`.'
  await writeDiary(date, content)
  return `Diary entry written for ${date}.`
}

// ─── Behaviour records ───────────────────────────────────────────────────

export async function handleMemoryAddBehaviorRecord(input: Record<string, unknown>): Promise<string> {
  const slug = asString(input.slug)
  const decision = asString(input.decision)
  const details = asString(input.details)
  if (!slug || !decision || !details) {
    return 'Missing one of `slug`, `decision`, `details`.'
  }
  const record = await addBehaviorRecord({ slug, decision, details })
  return `Recorded behaviour: ${record.filename}`
}

export async function handleMemoryListBehaviorRecords(): Promise<string> {
  const rows = await listBehaviorRecords()
  if (rows.length === 0) return 'No behaviour records yet.'
  return rows.map((r) => `${r.filename}\n  ${r.decision}`).join('\n\n')
}

export async function handleMemoryReadBehaviorRecord(input: Record<string, unknown>): Promise<string> {
  const filename = asString(input.filename)
  if (!filename) return 'Missing `filename`.'
  const content = await readBehaviorRecord(filename)
  return content ?? `No behaviour record found: ${filename}`
}

export async function handleMemoryRemoveBehaviorRecord(input: Record<string, unknown>): Promise<string> {
  const filename = asString(input.filename)
  if (!filename) return 'Missing `filename`.'
  await deleteBehaviorRecord(filename)
  return `Removed behaviour record: ${filename}`
}

// ─── Contacts ────────────────────────────────────────────────────────────

function asKind(v: unknown): ContactKind | null {
  if (typeof v !== 'string') return null
  const lower = v.toLowerCase()
  return (CONTACT_KINDS as string[]).includes(lower) ? (lower as ContactKind) : null
}

export async function handleMemoryNewContact(input: Record<string, unknown>): Promise<string> {
  const entity = asString(input.entity)
  if (!entity) return 'Missing `entity`.'
  const kind = asKind(input.kind) ?? 'other'
  const result = await newContact(entity, kind)
  return `Contact ready: ${result.entity} (${result.kind})`
}

export async function handleMemorySetContactKind(input: Record<string, unknown>): Promise<string> {
  const entity = asString(input.entity)
  const kind = asKind(input.kind)
  if (!entity) return 'Missing `entity`.'
  if (!kind) return `Missing or invalid \`kind\`. Use one of: ${CONTACT_KINDS.join(', ')}.`
  const result = await setContactKind(entity, kind)
  return `${result.entity} classified as ${result.kind}.`
}

export async function handleMemoryReadContact(input: Record<string, unknown>): Promise<string> {
  const entity = asString(input.entity)
  if (!entity) return 'Missing `entity`.'
  const content = await readContact(entity)
  return content ?? `No contact named "${entity}".`
}

export async function handleMemorySearchContacts(input: Record<string, unknown>): Promise<string> {
  const raw = input.queries
  if (!Array.isArray(raw)) return 'Missing `queries` (string[]).'
  const queries = raw.filter((q): q is string => typeof q === 'string')
  if (queries.length === 0) return 'Missing `queries` (string[]).'
  const result = await searchContacts(queries)
  return JSON.stringify(result, null, 2)
}

export async function handleMemoryAddContactNote(input: Record<string, unknown>): Promise<string> {
  const entity = asString(input.entity)
  const note = asString(input.note)
  if (!entity || !note) return 'Missing `entity` or `note`.'
  const result = await addContactNote(entity, note)
  return `Added note to ${result.entity}. Notes now: ${result.notes.length}.`
}

export async function handleMemoryRemoveContactNote(input: Record<string, unknown>): Promise<string> {
  const entity = asString(input.entity)
  const note = asString(input.note)
  if (!entity || !note) return 'Missing `entity` or `note`.'
  const result = await removeContactNote(entity, note)
  if (!result) return `No contact named "${entity}".`
  return `Removed note from ${result.entity}. Notes remaining: ${result.notes.length}.`
}

// Convenience for callers that need to know whether today's diary has been
// generated yet (UI signal, not a tool).
export async function todaysDiaryExists(): Promise<boolean> {
  return diaryExists(todaysDateKey())
}

export { ymdKey }
