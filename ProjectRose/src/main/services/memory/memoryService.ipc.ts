import { defineIpc, method } from '../../../shared/ipc/defineIpc'
import type {
  BehaviorRecord,
  CalendarEvent,
  CalendarRangeQuery,
  ContactEntity,
  ContactKind,
  ContactSearchResult,
  ContactsUpdaterStatus,
  CreateEventInput,
  DiaryIndexRow,
  DiaryScheduleStatus,
  EventAttendee,
  EventRef,
  GoogleApplyResult,
  GoogleCalendarPullPlan,
  GoogleCalendarPushPlan,
  GoogleCalendarRow,
  GoogleCalendarSyncStatus,
  GooglePullPlan,
  GooglePushPlan,
  GoogleSyncStatus,
  ResolvedEventOccurrence,
  UpdateEventPatch
} from '../../../shared/memory'

// IPC manifest for the host memory subsystem (~/.rose/memory/). Bound flat on
// window.api.memory.* — see src/preload/index.ts.

export const memoryIpc = defineIpc('memory', {
  // Diary
  listDiary: method<[], DiaryIndexRow[]>(),
  readDiary: method<[dateKey: string], string | null>(),
  writeDiary: method<[payload: { dateKey: string; content: string }], void>(),
  deleteDiary: method<[dateKey: string], void>(),

  // Behaviour records
  listBehaviorRecords: method<[], BehaviorRecord[]>(),
  readBehaviorRecord: method<[filename: string], string | null>(),
  writeBehaviorRecord: method<[payload: { filename: string; content: string }], void>(),
  deleteBehaviorRecord: method<[filename: string], void>(),
  addBehaviorRecord: method<[payload: { slug: string; decision: string; details: string }], BehaviorRecord>(),

  // Contacts
  listContacts: method<[], string[]>(),
  listContactsDetailed: method<[], Array<{ entity: string; kind: ContactKind }>>(),
  readContact: method<[entity: string], string | null>(),
  writeContact: method<[payload: { entity: string; content: string }], void>(),
  deleteContact: method<[entity: string], void>(),
  newContact: method<[entity: string], ContactEntity>(),
  addContactNote: method<[payload: { entity: string; note: string }], ContactEntity>(),
  removeContactNote: method<[payload: { entity: string; note: string }], ContactEntity | null>(),
  setContactKind: method<[payload: { entity: string; kind: ContactKind }], ContactEntity>(),
  searchContacts: method<[queries: string[]], ContactSearchResult>(),

  // Diary scheduler
  runDiaryNow: method<[], { written: boolean; dateKey: string }>(),
  regenerateTodayDiary: method<[], string>(),
  getScheduleStatus: method<[], DiaryScheduleStatus>(),

  // Contacts updater
  runContactsUpdaterNow: method<[], { swept: number; result: string | null }>(),
  getContactsUpdaterStatus: method<[], ContactsUpdaterStatus>(),

  // Google Contacts sync (Settings > Contacts > Google Sync). Each direction
  // is a two-step preview/apply so the renderer can show a dry-run modal
  // before any write happens.
  //
  // saveCredentials / clearCredentials manage the BYO OAuth pair the user
  // pastes into Settings → Providers → Google (see ADR 0009). signOut wipes
  // only the refresh token; clearCredentials wipes both halves of the pair.
  googleGetStatus: method<[], GoogleSyncStatus>(),
  googleSaveCredentials: method<[payload: { clientId: string; clientSecret: string }], GoogleSyncStatus>(),
  googleClearCredentials: method<[], GoogleSyncStatus>(),
  googleSignIn: method<[], GoogleSyncStatus>(),
  googleSignOut: method<[], GoogleSyncStatus>(),
  googlePreviewPull: method<[], GooglePullPlan>(),
  googleApplyPull: method<[plan: GooglePullPlan], GoogleApplyResult>(),
  googlePreviewPush: method<[], GooglePushPlan>(),
  googleApplyPush: method<[plan: GooglePushPlan], GoogleApplyResult>(),

  // Calendar / Memory.Event — local CRUD + Google Calendar sync (see ADR 0012).
  listEvents: method<[range: CalendarRangeQuery], ResolvedEventOccurrence[]>(),
  getEvent: method<[ref: EventRef], CalendarEvent | null>(),
  createEvent: method<[input: CreateEventInput], CalendarEvent>(),
  updateEvent: method<[payload: { ref: EventRef; patch: UpdateEventPatch }], CalendarEvent | null>(),
  deleteEvent: method<[ref: EventRef], void>(),
  inviteToEvent: method<[payload: { ref: EventRef; attendees: EventAttendee[] }], GoogleApplyResult>(),
  googleCalendarGetStatus: method<[], GoogleCalendarSyncStatus>(),
  googleCalendarListCalendars: method<[], GoogleCalendarRow[]>(),
  googleCalendarPreviewPull: method<[], GoogleCalendarPullPlan>(),
  googleCalendarApplyPull: method<[plan: GoogleCalendarPullPlan], GoogleApplyResult>(),
  googleCalendarPreviewPush: method<[], GoogleCalendarPushPlan>(),
  googleCalendarApplyPush: method<[plan: GoogleCalendarPushPlan], GoogleApplyResult>()
})
