import { readFile } from 'fs/promises'
import log from 'electron-log/main'
import type { Message } from '../../../shared/roseModelTypes'
import {
  DEFAULT_MEMORY_SETTINGS,
  type ContactsUpdaterStatus,
  type ConversationLogEntry,
  type MemorySettings
} from '../../../shared/memory'
import { runAgentOnce } from '../aiService'
import { applySettingsPatch, readSettings } from '../settingsService'
import { agentHomePath, recentWorkspacesPath } from '../../lib/agentHome'
import { readConversationLog } from './conversationLog'
import { todayKey, ymdKey } from './paths'
import {
  CONTACTS_UPDATER_SYSTEM_PROMPT,
  buildContactsUpdaterUserPrompt
} from './contactsUpdaterPrompt'

// Sweep interval. The user asked for every 30 minutes — hardcoded rather
// than configurable to keep the settings surface narrow. Change here if the
// cadence ever needs tuning.
export const CONTACTS_UPDATER_INTERVAL_MINUTES = 30
const CONTACTS_UPDATER_INTERVAL_MS = CONTACTS_UPDATER_INTERVAL_MINUTES * 60_000

// Tick once a minute — the same cadence as the diary scheduler — so the
// updater fires within a minute of its true 30-minute boundary regardless of
// when the app was launched.
const POLL_INTERVAL_MS = 60_000

// How far back to look when assembling the conversation slice. Cap at 24h
// even if the updater has been offline longer — older messages have already
// been processed by the diary and would inflate the prompt without value.
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000

interface SchedulerState {
  timer: NodeJS.Timeout | null
  running: boolean
}

const state: SchedulerState = { timer: null, running: false }

async function readMemoryBlock(): Promise<{
  contactsUpdaterEnabled: boolean
  contactsUpdaterLastRun: number | null
}> {
  const settings = await readSettings()
  const block = (settings.memory ?? {}) as {
    contactsUpdaterEnabled?: boolean
    contactsUpdaterLastRun?: number | null
  }
  return {
    contactsUpdaterEnabled: block.contactsUpdaterEnabled ?? true,
    contactsUpdaterLastRun: block.contactsUpdaterLastRun ?? null
  }
}

async function pickRootPath(): Promise<string> {
  try {
    const raw = await readFile(recentWorkspacesPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Array<{ path?: string }>
    const first = Array.isArray(parsed) ? parsed[0] : null
    if (first && typeof first.path === 'string' && first.path) return first.path
  } catch { /* fall through */ }
  return agentHomePath()
}

/**
 * Collect conversation log entries newer than `sinceMs`. Walks today plus
 * the previous day so we don't miss messages from the late-night side of
 * midnight when a sweep fires shortly after.
 */
async function gatherWindow(sinceMs: number): Promise<ConversationLogEntry[]> {
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const todayEntries = await readConversationLog(todayKey(now))
  const yesterdayKey = ymdKey(yesterday)
  const yesterdayEntries = todayKey(now) === yesterdayKey ? [] : await readConversationLog(yesterdayKey)
  const all = [...yesterdayEntries, ...todayEntries]
  return all.filter((e) => e.timestamp > sinceMs).sort((a, b) => a.timestamp - b.timestamp)
}

function describeWindow(sinceMs: number, now: number): string {
  const minutes = Math.max(1, Math.round((now - sinceMs) / 60_000))
  if (minutes < 60) return `last ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return `last ${hours}h`
}

/**
 * Run the contacts-updater once. Returns the number of new messages that
 * were swept, or null if the run was skipped (no new messages).
 */
export async function runContactsUpdater(): Promise<{
  ranAt: number
  swept: number
  result: string | null
}> {
  const now = Date.now()
  const memory = await readMemoryBlock()
  const lookbackFloor = now - MAX_LOOKBACK_MS
  const sinceMs = Math.max(memory.contactsUpdaterLastRun ?? 0, lookbackFloor)

  const slice = await gatherWindow(sinceMs)
  if (slice.length === 0) {
    // Still bump the timestamp so we don't keep re-scanning the same empty
    // window every minute.
    await applySettingsPatch({
      memory: { ...(await readMemoryFullBlock()), contactsUpdaterLastRun: now }
    })
    return { ranAt: now, swept: 0, result: null }
  }

  const rootPath = await pickRootPath()
  const messages: Message[] = [
    {
      role: 'user',
      content: buildContactsUpdaterUserPrompt({
        windowDescription: describeWindow(sinceMs, now),
        conversations: slice
      })
    }
  ]

  let resultText: string | null = null
  try {
    const response = await runAgentOnce(messages, rootPath, CONTACTS_UPDATER_SYSTEM_PROMPT)
    resultText = response.content
    log.info('[memory] contacts updater swept', slice.length, 'messages —', resultText.split('\n')[0])
  } catch (err) {
    log.error('[memory] contacts updater failed', err)
  }

  await applySettingsPatch({
    memory: { ...(await readMemoryFullBlock()), contactsUpdaterLastRun: now }
  })
  return { ranAt: now, swept: slice.length, result: resultText }
}

// Read the full memory block so we can patch it without dropping unrelated
// fields like diaryLastRun or the googleSync sub-block.
async function readMemoryFullBlock(): Promise<MemorySettings> {
  const settings = await readSettings()
  const block = (settings.memory ?? {}) as Partial<MemorySettings>
  return {
    ...DEFAULT_MEMORY_SETTINGS,
    ...block,
    googleSync: { ...DEFAULT_MEMORY_SETTINGS.googleSync, ...(block.googleSync ?? {}) }
  }
}

async function tick(): Promise<void> {
  if (state.running) return
  state.running = true
  try {
    const memory = await readMemoryBlock()
    if (!memory.contactsUpdaterEnabled) return
    const last = memory.contactsUpdaterLastRun ?? 0
    if (Date.now() - last < CONTACTS_UPDATER_INTERVAL_MS) return
    await runContactsUpdater()
  } catch (err) {
    log.error('[memory] contacts updater tick failed', err)
  } finally {
    state.running = false
  }
}

export function startContactsUpdater(): void {
  stopContactsUpdater()
  // Wait a beat after start so initial app load isn't tied up by an LLM call.
  setTimeout(() => { void tick() }, 30_000)
  state.timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
}

export function stopContactsUpdater(): void {
  if (state.timer) clearInterval(state.timer)
  state.timer = null
}

/** Manual "Run now" trigger from the Schedule sub-tab. Bypasses the 30-min wait. */
export async function runContactsUpdaterNow(): Promise<{ swept: number; result: string | null }> {
  const out = await runContactsUpdater()
  return { swept: out.swept, result: out.result }
}

export async function getContactsUpdaterStatus(): Promise<ContactsUpdaterStatus> {
  const memory = await readMemoryBlock()
  const last = memory.contactsUpdaterLastRun
  const nextRun = !memory.contactsUpdaterEnabled
    ? null
    : last === null
      ? Date.now()
      : last + CONTACTS_UPDATER_INTERVAL_MS
  return {
    enabled: memory.contactsUpdaterEnabled,
    intervalMinutes: CONTACTS_UPDATER_INTERVAL_MINUTES,
    lastRun: last,
    nextRun
  }
}
