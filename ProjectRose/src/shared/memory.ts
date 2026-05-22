// Types for the host memory subsystem (~/.rose/memory/).
//
// Memory is agent-global, not workspace-scoped — the Agent (single persistent
// identity per machine, per CONTEXT.md) carries diary, behaviour records, and
// contacts across every Workspace it operates in. Storage lives under
// ~/.rose/memory/ rather than <workspace>/.projectrose/memory/.

/** Diary entry index row — date string is yyyy-mm-dd, path is absolute. */
export interface DiaryIndexRow {
  date: string
  path: string
}

/** A behaviour-record file on disk. */
export interface BehaviorRecord {
  filename: string
  date: string
  slug: string
  decision: string
  details: string
}

/**
 * Classification for a Memory.Contact entity. Stored as a `- kind: <value>`
 * bullet inside the entity's markdown file (no schema change to the file
 * format — the parser just lifts that one bullet out into a typed field).
 * Drives the Google Contacts sync filter: by default only 'person' and
 * 'business' entities round-trip with Google.
 */
export type ContactKind = 'person' | 'business' | 'website' | 'other'

export const CONTACT_KINDS: ContactKind[] = ['person', 'business', 'website', 'other']

/** A contact-entity file on disk (a person, business, website, or other). */
export interface ContactEntity {
  entity: string
  kind: ContactKind
  notes: string[]
  path: string
}

/** Search-contacts result per the original spec — direct match plus relations. */
export interface ContactSearchResult {
  contact: string | null
  relations: { entity: string; note: string }[]
}

/** One row in the per-day conversation log (.jsonl). */
export interface ConversationLogEntry {
  timestamp: number
  sessionId: string
  rootPath: string
  role: 'user' | 'assistant'
  content: string
}

export type ActivityKind =
  | 'agent-handle-open'
  | 'agent-handle-message'
  | 'detached-run-start'
  | 'detached-run-end'

/** One row in the per-day extension-activity log (.jsonl). */
export interface ActivityLogEntry {
  timestamp: number
  extensionId: string
  kind: ActivityKind
  summary: string
}

/**
 * Persisted state for the Settings > Contacts tab's Google Contacts sync.
 * The OAuth refresh token does NOT live here — it's sealed in
 * userData/google-session.bin via safeStorage (see ADR 0008).
 *
 * No OAuth credentials live here either: the client_id is baked into the
 * build (src/shared/googleOAuth.ts, build-time replaceable via the
 * MAIN_VITE_GOOGLE_CLIENT_ID env var), and no client_secret is shipped or
 * needed (PKCE per RFC 8252; client_secret is Optional in Google's
 * loopback token-exchange spec).
 */
export interface GoogleSyncSettings {
  accountEmail: string | null
  lastPullAt: number | null
  lastPushAt: number | null
  /**
   * Per-kind enable map. A push only sends local entities whose kind is true
   * here; a pull only updates local entities whose existing kind is true
   * here (newly-pulled contacts default to 'person', so push/pull is mostly
   * symmetric for that case).
   */
  syncKinds: Record<ContactKind, boolean>
}

/** Settings block under AppSettings.memory. */
export interface MemorySettings {
  diaryEnabled: boolean
  diaryTime: string         // 'HH:MM' 24h
  diaryLastRun: number | null
  contactsUpdaterEnabled: boolean
  contactsUpdaterLastRun: number | null
  googleSync: GoogleSyncSettings
}

export const DEFAULT_GOOGLE_SYNC_SETTINGS: GoogleSyncSettings = {
  accountEmail: null,
  lastPullAt: null,
  lastPushAt: null,
  // Defaults match the typical Google Contacts use-case: people you know and
  // companies you deal with. Websites and "other" classifications stay local
  // unless the user opts in.
  syncKinds: { person: true, business: true, website: false, other: false }
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  diaryEnabled: true,
  diaryTime: '21:00',
  diaryLastRun: null,
  contactsUpdaterEnabled: true,
  contactsUpdaterLastRun: null,
  googleSync: DEFAULT_GOOGLE_SYNC_SETTINGS
}

/** Status response for the Schedule sub-tab. */
export interface DiaryScheduleStatus {
  enabled: boolean
  time: string
  lastRun: number | null
  nextRun: number | null
}

export interface ContactsUpdaterStatus {
  enabled: boolean
  intervalMinutes: number
  lastRun: number | null
  nextRun: number | null
}

// ─── Google Contacts sync ───────────────────────────────────────────────
// All sync work is user-triggered and explicitly confirmed. There is no
// background two-way sync — the renderer asks for a `preview*` plan first,
// shows the diff in a confirm modal, then calls `apply*` on user OK.

export interface GoogleSyncStatus {
  credentialsConfigured: boolean
  signedIn: boolean
  accountEmail: string | null
  lastPullAt: number | null
  lastPushAt: number | null
}

/** A single entity that will be created or updated locally on pull. */
export interface GooglePullEntry {
  entity: string                    // safe Memory.Contact entity name
  kind: ContactKind                 // resolved kind (existing or default 'person')
  googleResourceName: string        // People API resourceName
  newNotes: string[]                // bullet notes that will be appended
}

export interface GooglePullPlan {
  fetched: number
  create: GooglePullEntry[]
  update: GooglePullEntry[]
  unchanged: number
  /** Existing locals skipped because their current kind isn't in syncKinds. */
  skippedByKind: { entity: string; kind: ContactKind }[]
}

/** A single Memory.Contact entity that will be pushed to Google. */
export interface GooglePushEntry {
  entity: string
  kind: ContactKind
  reason: 'missing-in-google'
}

export interface GooglePushPlan {
  localCount: number
  create: GooglePushEntry[]
  skip: { entity: string; kind: ContactKind; reason: string }[]
}

export interface GoogleApplyResult {
  appliedAt: number
  ok: boolean
  message: string
}
