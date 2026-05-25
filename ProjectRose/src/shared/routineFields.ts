// Parse and serialize Routine definition files.
//
// Routines live on disk as markdown at
//   <workspace>/.projectrose/routines/{slug}.md
//
// Shape:
//
//   # Routine: Weekday morning brief
//   - enabled: true
//   - recurrence: RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
//   - fire-time: 09:00
//   - created: 2026-05-24T11:32:00
//   - last-fired: 2026-05-23T09:00:14
//   - tools:
//     - email_list_messages
//     - email_get_message
//     - memory_list_events
//
//   ## Prompt
//   Summarize my 10 most-recent unread emails…
//
// The `# Routine:` header carries the name. Structured metadata lives in
// bullets; the `## Prompt` (and any other `## …` section) collects free-form
// content the agent receives.
//
// Pure functions only, no IO — safe to import from either process.

export interface ParsedRoutine {
  /** Display name (the `# Routine:` header). */
  name: string
  /** Whether the scheduler should fire this routine. */
  enabled: boolean
  /**
   * Raw RRULE strings as they appear in the file. Multiple rules per routine
   * are permitted to mirror the calendar's representation, but the v1 UI
   * editor only emits a single RRULE.
   */
  recurrence: string[]
  /** Local clock HH:MM at which the routine fires on each occurrence. */
  fireTime: string
  /**
   * Tools this routine may use. Empty list = no tools (text-only run).
   * Interactive tools (ask_user, screenshot) are auto-stripped by the host
   * even if listed here.
   */
  tools: string[]
  /** ISO-local datetime when the routine was created. */
  createdAt: string | null
  /** ISO-local datetime of the most recent fire (scheduled or manual). */
  lastFiredAt: string | null
  /** Body sections keyed by header (`Prompt`, …). */
  sections: Record<string, string>
  /** Bullets the parser did not recognise. Preserved on round-trip. */
  extraBullets: string[]
}

const HEADER_RE = /^\s*#\s*Routine:\s*(.+?)\s*$/i
const BULLET_RE = /^(\s*)-\s+(.*?)\s*$/
const SECTION_RE = /^\s*##\s+(.+?)\s*$/

const KNOWN_LABELS = [
  'enabled',
  'recurrence',
  'rrule',
  'fire-time',
  'created',
  'last-fired',
  'tools'
] as const

type Label = typeof KNOWN_LABELS[number]

interface LabeledBullet {
  label: Label
  value: string
  indentSpaces: number
}

function tryParseLabeled(indent: number, bullet: string): LabeledBullet | { name: 'unlabeled'; value: string; indentSpaces: number } {
  const m = bullet.match(/^([a-z][a-z0-9-]*)\s*:\s*(.*?)\s*$/i)
  if (!m) return { name: 'unlabeled', value: bullet, indentSpaces: indent }
  const label = m[1].toLowerCase()
  const value = m[2]
  if (!(KNOWN_LABELS as readonly string[]).includes(label)) {
    return { name: 'unlabeled', value: bullet, indentSpaces: indent }
  }
  return { label: label as Label, value: value.trim(), indentSpaces: indent }
}

function parseBoolean(value: string): boolean {
  const lower = value.trim().toLowerCase()
  return lower === 'true' || lower === 'yes' || lower === '1'
}

function normaliseRruleBullet(label: 'recurrence' | 'rrule', value: string): string {
  const upper = value.toUpperCase()
  if (upper.startsWith('RRULE:')) return value
  if (label === 'rrule' || label === 'recurrence') return `RRULE:${value}`
  return value
}

/** Slugify a routine name for the on-disk filename. */
export function slugifyRoutineName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^\p{Letter}\p{Number}\s-]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'routine'
  )
}

export function emptyRoutine(): ParsedRoutine {
  return {
    name: '',
    enabled: true,
    recurrence: [],
    fireTime: '09:00',
    tools: [],
    createdAt: null,
    lastFiredAt: null,
    sections: {},
    extraBullets: []
  }
}

export function parseRoutineContent(content: string): ParsedRoutine {
  const out = emptyRoutine()
  let name = ''
  const lines = content.split(/\r?\n/)
  let i = 0
  let inToolsList = false
  for (; i < lines.length; i += 1) {
    const line = lines[i]
    if (!name) {
      const h = line.match(HEADER_RE)
      if (h) {
        name = h[1].trim()
        continue
      }
    }
    if (line.match(SECTION_RE)) break
    const bm = line.match(BULLET_RE)
    if (!bm) {
      inToolsList = false
      continue
    }
    const indent = bm[1].length
    const bullet = bm[2]
    // Indented bullets continue the most recent list. Today the only list-
    // bearing label is `tools:`.
    if (inToolsList && indent >= 2) {
      const value = bullet.trim()
      if (value.length > 0) out.tools.push(value)
      continue
    }
    inToolsList = false
    const labeled = tryParseLabeled(indent, bullet)
    if ('name' in labeled && labeled.name === 'unlabeled') {
      out.extraBullets.push(labeled.value)
      continue
    }
    const l = labeled as LabeledBullet
    switch (l.label) {
      case 'enabled':
        out.enabled = parseBoolean(l.value)
        break
      case 'recurrence':
      case 'rrule':
        out.recurrence.push(normaliseRruleBullet(l.label, l.value))
        break
      case 'fire-time':
        out.fireTime = l.value
        break
      case 'created':
        out.createdAt = l.value
        break
      case 'last-fired':
        out.lastFiredAt = l.value
        break
      case 'tools':
        // Either inline `tools: a, b, c` or the start of an indented sub-list.
        if (l.value.length === 0) {
          inToolsList = true
        } else {
          for (const t of l.value.split(',').map((s) => s.trim()).filter(Boolean)) {
            out.tools.push(t)
          }
        }
        break
    }
  }
  out.name = name

  // Section walk.
  let currentHeader: string | null = null
  let buffer: string[] = []
  const flush = (): void => {
    if (!currentHeader) return
    out.sections[currentHeader] = buffer.join('\n').trim()
    buffer = []
  }
  for (; i < lines.length; i += 1) {
    const line = lines[i]
    const sm = line.match(SECTION_RE)
    if (sm) {
      flush()
      currentHeader = sm[1].trim()
      continue
    }
    if (currentHeader) buffer.push(line)
  }
  flush()
  return out
}

export function buildRoutineMarkdown(routine: ParsedRoutine): string {
  const name = routine.name.trim() || 'Untitled routine'
  const lines: string[] = [`# Routine: ${name}`]
  lines.push(`- enabled: ${routine.enabled ? 'true' : 'false'}`)
  for (const r of routine.recurrence) lines.push(`- recurrence: ${r}`)
  lines.push(`- fire-time: ${routine.fireTime}`)
  if (routine.createdAt) lines.push(`- created: ${routine.createdAt}`)
  if (routine.lastFiredAt) lines.push(`- last-fired: ${routine.lastFiredAt}`)
  if (routine.tools.length > 0) {
    lines.push(`- tools:`)
    for (const t of routine.tools) lines.push(`  - ${t}`)
  }
  for (const extra of routine.extraBullets) lines.push(`- ${extra}`)

  // Sections — Prompt first if present, then any others alphabetically.
  const entries = Object.entries(routine.sections).filter(([, body]) => body.trim().length > 0)
  entries.sort((a, b) => {
    if (a[0] === 'Prompt') return -1
    if (b[0] === 'Prompt') return 1
    return a[0].localeCompare(b[0])
  })
  for (const [header, body] of entries) {
    lines.push('', `## ${header}`, body.trim())
  }
  return lines.join('\n') + '\n'
}

/** Convenience: get the prompt body from a parsed routine. */
export function getRoutinePrompt(routine: ParsedRoutine): string {
  return routine.sections['Prompt'] ?? ''
}
