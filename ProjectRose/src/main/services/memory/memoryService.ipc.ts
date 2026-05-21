import { defineIpc, method } from '../../../shared/ipc/defineIpc'
import type {
  BehaviorRecord,
  ContactEntity,
  ContactSearchResult,
  ContactsUpdaterStatus,
  DiaryIndexRow,
  DiaryScheduleStatus,
  GoogleApplyResult,
  GooglePullPlan,
  GooglePushPlan,
  GoogleSyncStatus
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
  readContact: method<[entity: string], string | null>(),
  writeContact: method<[payload: { entity: string; content: string }], void>(),
  deleteContact: method<[entity: string], void>(),
  newContact: method<[entity: string], ContactEntity>(),
  addContactNote: method<[payload: { entity: string; note: string }], ContactEntity>(),
  removeContactNote: method<[payload: { entity: string; note: string }], ContactEntity | null>(),
  searchContacts: method<[query: string], ContactSearchResult>(),

  // Diary scheduler
  runDiaryNow: method<[], { written: boolean; dateKey: string }>(),
  regenerateTodayDiary: method<[], string>(),
  getScheduleStatus: method<[], DiaryScheduleStatus>(),

  // Contacts updater
  runContactsUpdaterNow: method<[], { swept: number; result: string | null }>(),
  getContactsUpdaterStatus: method<[], ContactsUpdaterStatus>(),

  // Google Contacts sync (Settings > Contacts > Google Sync). Each direction
  // is a two-step preview/apply so the renderer can show a dry-run modal
  // before any write happens — per design note in docs/adr/0008.
  googleGetStatus: method<[], GoogleSyncStatus>(),
  googleSignIn: method<[], GoogleSyncStatus>(),
  googleSignOut: method<[], GoogleSyncStatus>(),
  googlePreviewPull: method<[], GooglePullPlan>(),
  googleApplyPull: method<[plan: GooglePullPlan], GoogleApplyResult>(),
  googlePreviewPush: method<[], GooglePushPlan>(),
  googleApplyPush: method<[plan: GooglePushPlan], GoogleApplyResult>()
})
