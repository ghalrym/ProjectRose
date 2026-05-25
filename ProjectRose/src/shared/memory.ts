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

/**
 * One contact in a search result. A hit appears if at least one query matched
 * the entity name or one of its notes (case-insensitive substring).
 * `matchedQueryCount` and `totalMatches` drive ranking — higher = more
 * relevant.
 */
export interface ContactSearchHit {
  entity: string
  kind: ContactKind
  /** Distinct queries that matched somewhere on this contact. */
  matchedQueryCount: number
  /** Sum of name + note matches across every query (a query that matches both name and a note counts as 2). */
  totalMatches: number
  /** Queries that matched the entity name. */
  nameMatches: string[]
  /** Notes that matched at least one query, deduped, with the queries each note matched. */
  noteMatches: { note: string; queries: string[] }[]
  /** Full contact file markdown — supplied only when the hit's name matched a query. */
  contact: string | null
}

/**
 * Multi-query contact search result. Hits are ranked: higher
 * `matchedQueryCount` first, then higher `totalMatches`, then alphabetical
 * by entity. Hits whose name matched a query carry the full contact markdown
 * in `contact`; relation-only hits carry `contact: null`.
 */
export interface ContactSearchResult {
  queries: string[]
  hits: ContactSearchHit[]
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
 * userData/google-session.bin via safeStorage.
 *
 * The user-supplied OAuth client pair lives separately (the clientId in
 * AppSettings.googleAuth, the clientSecret encrypted in
 * userData/google-oauth-secret.bin) — see ADR 0009.
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
  googleCalendarSync?: GoogleCalendarSyncSettings
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
  googleSync: DEFAULT_GOOGLE_SYNC_SETTINGS,
  googleCalendarSync: { lastPullAt: null, lastPushAt: null, syncCalendars: { primary: true } }
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
  // True when the running build ships its own Google OAuth pair, so the user
  // doesn't supply (or see) credential inputs. See ADR 0009 amendment.
  credentialsBundled: boolean
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

/** A single Memory.Contact entity that will be created in Google. */
export interface GooglePushEntry {
  entity: string
  kind: ContactKind
  reason: 'missing-in-google'
  /**
   * Bullet-formatted preview of what's being sent (e.g. `email: x@y (work)`,
   * `phone: 555 (mobile)`, biography lines). Empty if the contact has only
   * a name. Shown in the confirm modal.
   */
  fields: string[]
}

/** A Memory.Contact entity that's already in Google and has extra local fields. */
export interface GooglePushUpdate {
  entity: string
  kind: ContactKind
  /** People API resourceName, used by apply to target the right Google contact. */
  googleResourceName: string
  /**
   * Bullet-formatted list of fields that will be appended to Google. Computed
   * additively — Google's existing fields are never removed or overwritten.
   */
  additions: string[]
}

export interface GooglePushPlan {
  localCount: number
  create: GooglePushEntry[]
  update: GooglePushUpdate[]
  skip: { entity: string; kind: ContactKind; reason: string }[]
}

export interface GoogleApplyResult {
  appliedAt: number
  ok: boolean
  message: string
}

// ─── Calendar / Events (Memory.Event) ───────────────────────────────────
//
// The Agent's calendar lives at `~/.rose/memory/calendar/{yyyy}/{mm}/{dd}/`
// with one markdown file per event. Recurring events store the master at its
// first-occurrence date with an RRULE bullet; the runtime expands occurrences
// on demand via the `rrule` library. Optional Google Calendar sync mirrors
// the rose-contacts pattern (preview/apply pull + push) and reuses the shared
// Google OAuth client.

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'

export type AttendeeResponseStatus =
  | 'needsAction'
  | 'declined'
  | 'tentative'
  | 'accepted'

export interface EventAttendee {
  email: string
  displayName?: string
  responseStatus: AttendeeResponseStatus
  organizer?: boolean
  self?: boolean
}

export interface EventTime {
  value: string
  timeZone: string | null
  allDay: boolean
}

/** A reference to an event file on disk. */
export interface EventRef {
  /** yyyy-mm-dd of the file's parent directory (the event's first-occurrence date). */
  date: string
  /** Filename without the .md extension. */
  slug: string
}

/** A persisted event read from `{date}/{slug}.md`. */
export interface CalendarEvent {
  ref: EventRef
  path: string
  summary: string
  description: string
  status: EventStatus
  location: string | null
  start: EventTime | null
  end: EventTime | null
  attendees: EventAttendee[]
  /** Raw RRULE / RDATE / EXDATE strings as stored on disk. */
  recurrence: string[]
  googleId: string | null
  googleCalendarId: string | null
  recurringMasterId: string | null
  originalStart: EventTime | null
}

/**
 * A single resolved occurrence — either a non-recurring event, one expansion
 * of a recurring master, or an exception event linking back to a master.
 * Times are concrete (allDay flag preserved).
 */
export interface ResolvedEventOccurrence {
  master: CalendarEvent
  start: EventTime
  end: EventTime
  isRecurringInstance: boolean
  isException: boolean
}

export interface CreateEventInput {
  summary: string
  start: EventTime
  end: EventTime
  description?: string
  location?: string
  attendees?: EventAttendee[]
  recurrence?: string[]
  status?: EventStatus
  calendarId?: string
}

export interface UpdateEventPatch {
  summary?: string
  description?: string
  location?: string | null
  status?: EventStatus
  start?: EventTime
  end?: EventTime
  attendees?: EventAttendee[]
  recurrence?: string[]
}

export interface CalendarRangeQuery {
  /** ISO date-time (inclusive lower bound). */
  start: string
  /** ISO date-time (exclusive upper bound). */
  end: string
  /** Optional list of Google calendar IDs to keep. Local-only events are always included. */
  calendarIds?: string[]
}

// ─── Google Calendar sync ────────────────────────────────────────────────

/** Per-calendar settings for sync (one row per Google calendar). */
export interface GoogleCalendarSyncSettings {
  lastPullAt: number | null
  lastPushAt: number | null
  /**
   * Per-Google-calendar opt-in for sync. Keys are Google calendarId strings
   * ('primary', the calendar email address, etc.). New keys default to false
   * except 'primary' which defaults to true.
   */
  syncCalendars: Record<string, boolean>
}

export const DEFAULT_GOOGLE_CALENDAR_SYNC_SETTINGS: GoogleCalendarSyncSettings = {
  lastPullAt: null,
  lastPushAt: null,
  syncCalendars: { primary: true }
}

export interface GoogleCalendarRow {
  id: string
  summary: string
  primary: boolean
  accessRole: string | null
  backgroundColor: string | null
}

export interface GoogleCalendarSyncStatus {
  credentialsConfigured: boolean
  signedIn: boolean
  accountEmail: string | null
  scopeGranted: boolean
  lastPullAt: number | null
  lastPushAt: number | null
  calendars: GoogleCalendarRow[]
}

export interface GoogleCalendarPullEntry {
  summary: string
  /** Display string for the preview modal — the raw Google start.date / start.dateTime. */
  start: string
  end: string
  googleId: string
  googleCalendarId: string
  isRecurringMaster: boolean
  isException: boolean
  /**
   * Normalised payload populated by `previewPull` and consumed by `applyPull`
   * directly — no second Google API call. Carrying it through the IPC plan
   * makes the apply phase atomic (what the user confirms is what gets
   * written) and removes the iCalUID re-fetch ambiguity (Google's
   * `events.list({iCalUID, singleEvents: false})` can return master +
   * exception items together; picking `[0]` was unsafe).
   */
  payload: {
    summary: string
    start: EventTime
    end: EventTime
    description: string
    location: string | null
    status: EventStatus
    attendees: EventAttendee[]
    recurrence: string[]
    googleId: string
    googleCalendarId: string
    googleEventId: string
    recurringMasterId: string | null
    originalStart: EventTime | null
  }
}

export interface GoogleCalendarPullPlan {
  fetched: number
  create: GoogleCalendarPullEntry[]
  update: GoogleCalendarPullEntry[]
  unchanged: number
  /** Calendars present at the account but currently filtered off via syncCalendars. */
  skippedCalendars: { id: string; summary: string }[]
}

export interface GoogleCalendarPushEntry {
  ref: EventRef
  summary: string
  start: string
  end: string
  targetCalendarId: string
}

export interface GoogleCalendarPushUpdate {
  ref: EventRef
  googleId: string
  googleCalendarId: string
  summary: string
  fields: string[]
}

export interface GoogleCalendarPushPlan {
  localCount: number
  create: GoogleCalendarPushEntry[]
  update: GoogleCalendarPushUpdate[]
  skip: { ref: EventRef; reason: string }[]
}
