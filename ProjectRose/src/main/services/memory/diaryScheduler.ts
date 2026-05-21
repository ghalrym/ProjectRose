import { readFile } from 'fs/promises'
import log from 'electron-log/main'
import type { Message } from '../../../shared/roseModelTypes'
import type { DiaryScheduleStatus, MemorySettings } from '../../../shared/memory'
import { DEFAULT_MEMORY_SETTINGS } from '../../../shared/memory'
import { runAgentOnce } from '../aiService'
import { readSettings, applySettingsPatch } from '../settingsService'
import { agentHomePath, recentWorkspacesPath } from '../../lib/agentHome'
import { diaryExists, writeDiary } from './diary'
import { readConversationLog } from './conversationLog'
import { readActivityLog } from './agentActivity'
import { buildDiaryUserPrompt, DIARY_SYSTEM_PROMPT } from './diaryPrompt'
import { todayKey } from './paths'

// Polling cadence. Matches rose-heartbeat's once-a-minute tick — granular
// enough that the diary fires within a minute of the configured time, cheap
// enough that the timer is not a load consideration.
const POLL_INTERVAL_MS = 60_000

interface ScheduleState {
  timer: NodeJS.Timeout | null
  running: boolean
}

const state: ScheduleState = { timer: null, running: false }

function parseHHMM(value: string): { h: number; m: number } | null {
  const m = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return { h: Number(m[1]), m: Number(m[2]) }
}

/** Has the configured fire time already passed today (local time)? */
function hasFireTimeArrived(hhmm: string, now: Date = new Date()): boolean {
  const t = parseHHMM(hhmm)
  if (!t) return false
  const fireAt = new Date(now)
  fireAt.setHours(t.h, t.m, 0, 0)
  return now.getTime() >= fireAt.getTime()
}

/** Compute the next epoch-ms when the scheduler will fire. */
function computeNextFire(hhmm: string, now: Date = new Date()): number | null {
  const t = parseHHMM(hhmm)
  if (!t) return null
  const fireAt = new Date(now)
  fireAt.setHours(t.h, t.m, 0, 0)
  if (fireAt.getTime() <= now.getTime()) {
    fireAt.setDate(fireAt.getDate() + 1)
  }
  return fireAt.getTime()
}

async function pickRootPath(): Promise<string> {
  // The diary writer needs a rootPath only for tool sandboxing. We prefer the
  // most-recently-opened workspace so the agent's tool calls (if any) feel
  // attached to "where the work is happening"; we fall back to the agent
  // home, which always exists.
  try {
    const raw = await readFile(recentWorkspacesPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Array<{ path?: string }> | { path?: string }[]
    const first = Array.isArray(parsed) ? parsed[0] : null
    if (first && typeof first.path === 'string' && first.path) return first.path
  } catch { /* fall through */ }
  return agentHomePath()
}

/**
 * Generate the diary entry for `dateKey`, regardless of whether one already
 * exists. Returns the file content written.
 */
export async function generateDiary(dateKey: string): Promise<string> {
  const [conversations, activity, rootPath] = await Promise.all([
    readConversationLog(dateKey),
    readActivityLog(dateKey),
    pickRootPath()
  ])
  const userPrompt = buildDiaryUserPrompt({ dateKey, conversations, activity })
  const messages: Message[] = [
    { role: 'user', content: userPrompt }
  ]
  const response = await runAgentOnce(messages, rootPath, DIARY_SYSTEM_PROMPT)
  const content = response.content.trim() + '\n'
  await writeDiary(dateKey, content)
  const current = await readMemorySettings()
  await applySettingsPatch({ memory: { ...current, diaryLastRun: Date.now() } })
  return content
}

async function readMemorySettings(): Promise<MemorySettings> {
  const settings = await readSettings()
  const block = (settings.memory ?? {}) as Partial<MemorySettings>
  return { ...DEFAULT_MEMORY_SETTINGS, ...block }
}

async function tick(): Promise<void> {
  if (state.running) return
  state.running = true
  try {
    const settings = await readMemorySettings()
    if (!settings.diaryEnabled) return
    if (!hasFireTimeArrived(settings.diaryTime)) return
    const today = todayKey()
    if (await diaryExists(today)) return
    log.info('[memory] diary scheduler firing for', today)
    await generateDiary(today)
  } catch (err) {
    log.error('[memory] diary scheduler tick failed', err)
  } finally {
    state.running = false
  }
}

export function startDiaryScheduler(): void {
  stopDiaryScheduler()
  // Tick once shortly after start, then every minute. The initial delay lets
  // the app finish opening windows before any LLM call lands.
  setTimeout(() => { void tick() }, 5_000)
  state.timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
}

export function stopDiaryScheduler(): void {
  if (state.timer) clearInterval(state.timer)
  state.timer = null
}

/** Manual "Run now" trigger — bypasses the time check but still no-ops if today's diary exists. */
export async function runDiaryNow(): Promise<{ written: boolean; dateKey: string }> {
  const today = todayKey()
  if (await diaryExists(today)) return { written: false, dateKey: today }
  await generateDiary(today)
  return { written: true, dateKey: today }
}

/** Force re-generation of today's diary, overwriting any existing file. */
export async function regenerateTodayDiary(): Promise<string> {
  return generateDiary(todayKey())
}

export async function getScheduleStatus(): Promise<DiaryScheduleStatus> {
  const s = await readMemorySettings()
  return {
    enabled: s.diaryEnabled,
    time: s.diaryTime,
    lastRun: s.diaryLastRun,
    nextRun: s.diaryEnabled ? computeNextFire(s.diaryTime) : null
  }
}
