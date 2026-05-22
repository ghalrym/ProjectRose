// Pure mapping between Google People API resources and Memory.Contact bullet
// notes. Kept free of IO so it can be unit-tested without electron/fs.
//
// The user-chosen contract (see plan): Google's structured fields flatten
// into labelled bullets ("- email: jane@x.com"). The `# Entity: Name` header
// stays unchanged. Notes are appended via the existing addContactNote()
// dedup path in contacts.ts, so re-running a pull is idempotent.

import type { people_v1 } from 'googleapis'
import type { ContactKind } from '../../../shared/memory'

/** Single Person resource as the People API returns it. */
export type GooglePerson = people_v1.Schema$Person

/** What the agent stores about one Google contact. */
export interface MappedContact {
  /** Display name (used as the Memory entity filename). */
  entity: string
  /**
   * Kind newly-pulled contacts get. Per user spec we always default to
   * 'person' on pull (Google's API has no equivalent field) and let the
   * user reclassify in the editor afterwards.
   */
  kind: ContactKind
  /** People API resourceName, kept for future bidirectional updates. */
  googleResourceName: string
  /** Bullet-note lines, each ready to be passed to addContactNote(). */
  notes: string[]
}

/**
 * Pick a primary display name from the Google Person. Falls back through
 * displayName → familyName + givenName → first email local-part → null.
 * Returning null tells the caller to skip the contact (un-nameable).
 */
export function pickDisplayName(person: GooglePerson): string | null {
  const names = person.names ?? []
  const primary = names.find((n) => n.metadata?.primary) ?? names[0]
  if (primary?.displayName?.trim()) return primary.displayName.trim()
  if (primary?.givenName || primary?.familyName) {
    return [primary.givenName, primary.familyName].filter(Boolean).join(' ').trim() || null
  }
  const email = (person.emailAddresses ?? [])[0]?.value
  if (email) return email.split('@')[0]
  return null
}

function labelled(type: string | null | undefined, value: string): string {
  const t = (type ?? '').trim()
  return t ? `${value} (${t})` : value
}

/**
 * Flatten one Google Person into bullet-note lines. The list deduplicates
 * within itself (Google sometimes returns duplicate email/phone entries
 * across primary/secondary metadata).
 */
export function flattenPersonToNotes(person: GooglePerson): string[] {
  const out: string[] = []
  const push = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (!out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed)
  }

  for (const e of person.emailAddresses ?? []) {
    if (e.value) push(`email: ${labelled(e.type, e.value)}`)
  }
  for (const p of person.phoneNumbers ?? []) {
    if (p.value) push(`phone: ${labelled(p.type, p.value)}`)
  }
  for (const a of person.addresses ?? []) {
    const formatted = (a.formattedValue ?? '').replace(/\s+/g, ' ').trim()
    if (formatted) push(`address: ${labelled(a.type, formatted)}`)
  }
  for (const o of person.organizations ?? []) {
    if (o.name) push(`org: ${o.name}`)
    if (o.title) push(`title: ${o.title}`)
  }
  for (const u of person.urls ?? []) {
    if (u.value) push(`url: ${labelled(u.type, u.value)}`)
  }
  for (const b of person.biographies ?? []) {
    const text = (b.value ?? '').trim()
    if (text) {
      // Biographies are user-authored prose; split on newlines so each line
      // becomes its own bullet rather than one giant note.
      for (const line of text.split(/\r?\n/)) {
        const line2 = line.trim()
        if (line2) push(line2)
      }
    }
  }
  return out
}

export function mapPerson(person: GooglePerson): MappedContact | null {
  const entity = pickDisplayName(person)
  if (!entity) return null
  if (!person.resourceName) return null
  return {
    entity,
    kind: 'person',
    googleResourceName: person.resourceName,
    notes: flattenPersonToNotes(person)
  }
}
