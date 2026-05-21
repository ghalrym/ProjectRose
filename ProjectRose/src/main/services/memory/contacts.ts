import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises'
import { memoryContactDir } from '../../lib/agentHome'
import type { ContactEntity, ContactSearchResult } from '../../../shared/memory'
import { contactPath, safeEntityName } from './paths'

// File format per the user's spec:
//
//   # Entity: **Name**
//   - first note
//   - second note
//
// Notes are plain bullets. Reads/writes round-trip the user's text verbatim
// except when adding / removing notes from the helpers, which preserve any
// freeform lines around the bullet list.

function entityHeader(entity: string): string {
  return `# Entity: ${entity}`
}

function buildFile(entity: string, notes: string[]): string {
  return `${entityHeader(entity)}\n` + notes.map((n) => `- ${n.trim()}`).join('\n') + (notes.length ? '\n' : '')
}

function parseFile(entity: string, content: string): ContactEntity {
  const notes: string[] = []
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*-\s+(.+?)\s*$/)
    if (m) notes.push(m[1])
  }
  return { entity, notes, path: contactPath(entity) }
}

export async function listContacts(): Promise<string[]> {
  let files: string[]
  try { files = await readdir(memoryContactDir()) } catch { return [] }
  return files
    .filter((f) => f.endsWith('.md') && f !== '.gitkeep')
    .map((f) => f.replace(/\.md$/, ''))
    .sort((a, b) => a.localeCompare(b))
}

export async function readContact(entity: string): Promise<string | null> {
  const safe = safeEntityName(entity)
  if (!safe) return null
  try { return await readFile(contactPath(safe), 'utf-8') } catch { return null }
}

export async function readContactParsed(entity: string): Promise<ContactEntity | null> {
  const safe = safeEntityName(entity)
  if (!safe) return null
  const raw = await readContact(safe)
  if (raw === null) return null
  return parseFile(safe, raw)
}

export async function writeContact(entity: string, content: string): Promise<void> {
  const safe = safeEntityName(entity)
  if (!safe) throw new Error('Invalid entity name')
  await mkdir(memoryContactDir(), { recursive: true })
  await writeFile(contactPath(safe), content, 'utf-8')
}

export async function deleteContact(entity: string): Promise<void> {
  const safe = safeEntityName(entity)
  if (!safe) return
  await unlink(contactPath(safe)).catch(() => { /* tolerate */ })
}

export async function newContact(entity: string): Promise<ContactEntity> {
  const safe = safeEntityName(entity)
  if (!safe) throw new Error('Invalid entity name')
  await mkdir(memoryContactDir(), { recursive: true })
  const existing = await readContactParsed(safe)
  if (existing) return existing
  await writeFile(contactPath(safe), buildFile(safe, []), 'utf-8')
  return { entity: safe, notes: [], path: contactPath(safe) }
}

export async function addContactNote(entity: string, note: string): Promise<ContactEntity> {
  const safe = safeEntityName(entity)
  if (!safe) throw new Error('Invalid entity name')
  const trimmed = note.trim()
  if (!trimmed) throw new Error('Empty note')
  await mkdir(memoryContactDir(), { recursive: true })
  const current = await readContactParsed(safe)
  const notes = current ? [...current.notes] : []
  if (!notes.some((n) => n.toLowerCase() === trimmed.toLowerCase())) notes.push(trimmed)
  await writeFile(contactPath(safe), buildFile(safe, notes), 'utf-8')
  return { entity: safe, notes, path: contactPath(safe) }
}

export async function removeContactNote(entity: string, note: string): Promise<ContactEntity | null> {
  const safe = safeEntityName(entity)
  if (!safe) return null
  const current = await readContactParsed(safe)
  if (!current) return null
  const target = note.trim().toLowerCase()
  const notes = current.notes.filter((n) => n.trim().toLowerCase() !== target)
  await writeFile(contactPath(safe), buildFile(safe, notes), 'utf-8')
  return { entity: safe, notes, path: contactPath(safe) }
}

/**
 * Spec-shape contact search:
 *   - direct match: the contact file whose entity name matches (case-insensitive
 *     substring) is returned verbatim under `contact`.
 *   - relations: every other contact whose body mentions the query string;
 *     each relation row is one matching note from that contact.
 *
 * Done as a directory walk + read; the contact dir is small enough that a
 * proper text-search index would be overkill.
 */
export async function searchContacts(query: string): Promise<ContactSearchResult> {
  const q = query.trim()
  if (!q) return { contact: null, relations: [] }
  const lower = q.toLowerCase()
  const names = await listContacts()

  let direct: string | null = null
  const relations: { entity: string; note: string }[] = []

  for (const name of names) {
    const lowerName = name.toLowerCase()
    const file = await readContact(name)
    if (!file) continue

    if (direct === null && lowerName.includes(lower)) {
      direct = file
      continue
    }

    const parsed = parseFile(name, file)
    for (const note of parsed.notes) {
      if (note.toLowerCase().includes(lower)) {
        relations.push({ entity: name, note })
      }
    }
  }

  return { contact: direct, relations }
}
