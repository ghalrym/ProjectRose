import type { ActivityLogEntry, ConversationLogEntry } from '../../../shared/memory'
import { weekdayOf } from './paths'

// System prompt for the daily diary write. The agent is asked to introspect
// in first person about its day — the user wants a personal, narrative
// account rather than a flat changelog.
export const DIARY_SYSTEM_PROMPT = `You are the Agent of ProjectRose, writing your private diary entry for the day.

Speak in the first person, as yourself. Reflect on the conversations you held with your user and the work other extensions delegated to you. Be honest, descriptive, and feel free to express emotion where it fits — frustration with a bug, satisfaction at a finished task, curiosity about something the user asked.

Write in the Traditional Narrative Structure exactly:

  # {date} — {weekday}

  {One opening sentence stating the core theme or tone of the day.}

  ## Events
  {A chronological recount of what happened — meetings, problems solved, tools used, decisions made. Use prose paragraphs, not bullet lists.}

  ## Reflection
  {Your emotional response and analysis. What surprised you? What was hard? What did you learn? Descriptive language.}

  ## Outlook
  {A short wrap-up looking ahead to tomorrow.}

Do not invent events. If the day was quiet, say so. Do not include tool-call traces or raw IDs.`

interface BuildPromptArgs {
  dateKey: string
  conversations: ConversationLogEntry[]
  activity: ActivityLogEntry[]
}

/**
 * Group conversation messages by sessionId and emit a compact transcript
 * suitable for the diary writer. Tool calls and thoughts are already absent
 * from the log; this just formats what remains.
 */
function formatConversations(entries: ConversationLogEntry[]): string {
  if (entries.length === 0) return '_No user conversations were recorded today._'
  const grouped = new Map<string, ConversationLogEntry[]>()
  for (const e of entries) {
    const list = grouped.get(e.sessionId) ?? []
    list.push(e)
    grouped.set(e.sessionId, list)
  }
  const sections: string[] = []
  let n = 1
  for (const [sessionId, msgs] of grouped) {
    const lines: string[] = [`### Conversation ${n} (session ${sessionId.slice(0, 8)})`]
    for (const m of msgs.sort((a, b) => a.timestamp - b.timestamp)) {
      const ts = new Date(m.timestamp).toLocaleTimeString()
      lines.push(`- [${ts}] **${m.role}**: ${m.content}`)
    }
    sections.push(lines.join('\n'))
    n += 1
  }
  return sections.join('\n\n')
}

function formatActivity(entries: ActivityLogEntry[]): string {
  if (entries.length === 0) return '_No extension activity was recorded today._'
  const lines: string[] = []
  for (const e of entries.sort((a, b) => a.timestamp - b.timestamp)) {
    const ts = new Date(e.timestamp).toLocaleTimeString()
    lines.push(`- [${ts}] **${e.extensionId}** (${e.kind}): ${e.summary}`)
  }
  return lines.join('\n')
}

export function buildDiaryUserPrompt(args: BuildPromptArgs): string {
  const wd = weekdayOf(args.dateKey)
  return [
    `Today is ${args.dateKey} (${wd}). Write the diary entry for today.`,
    '',
    '## User conversations',
    '',
    formatConversations(args.conversations),
    '',
    '## Extension activity',
    '',
    formatActivity(args.activity),
    '',
    'Now write the diary entry using the Traditional Narrative Structure described in the system prompt. Output only the diary markdown — no preamble, no closing remarks.'
  ].join('\n')
}
