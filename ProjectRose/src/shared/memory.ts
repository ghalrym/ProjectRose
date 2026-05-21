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

/** A contact-entity file on disk (a person, place, or thing). */
export interface ContactEntity {
  entity: string
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
 * `clientId` / `clientSecret` are the user-provisioned OAuth desktop-client
 * credentials. Google itself treats the secret as non-confidential for the
 * "Desktop app" client type, so storing it next to the other settings is
 * acceptable; only the refresh token gets the safeStorage treatment.
 */
export interface GoogleSyncSettings {
  clientId: string
  clientSecret: string
  accountEmail: string | null
  lastPullAt: number | null
  lastPushAt: number | null
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
  clientId: '',
  clientSecret: '',
  accountEmail: null,
  lastPullAt: null,
  lastPushAt: null
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
  googleResourceName: string        // People API resourceName
  newNotes: string[]                // bullet notes that will be appended
}

export interface GooglePullPlan {
  fetched: number
  create: GooglePullEntry[]
  update: GooglePullEntry[]
  unchanged: number
}

/** A single Memory.Contact entity that will be pushed to Google. */
export interface GooglePushEntry {
  entity: string
  reason: 'missing-in-google'
}

export interface GooglePushPlan {
  localCount: number
  create: GooglePushEntry[]
  skip: { entity: string; reason: string }[]
}

export interface GoogleApplyResult {
  appliedAt: number
  ok: boolean
  message: string
}
