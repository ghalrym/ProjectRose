// Routine fire transcript — the structured shape returned by the
// `detachedRunWithTools` capability (see ADR 0014) and the on-disk format
// for `<workspace>/.projectrose/routines/{slug}/runs/{timestamp}.md`.
//
// Pure functions only, no IO — safe to import from main or renderer.

export type RoutineTranscriptEntry =
  | { kind: 'user_message'; content: string }
  | { kind: 'assistant_thought'; content: string }
  | { kind: 'assistant_message'; content: string }
  | { kind: 'tool_call'; toolName: string; toolCallId: string; input: unknown }
  | { kind: 'tool_result'; toolName: string; toolCallId: string; output: string }

export interface RoutineTranscript {
  entries: RoutineTranscriptEntry[]
  finalText: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  modelDisplay: string
}

export type RoutineRunTrigger = 'scheduled' | 'manual'
export type RoutineRunStatus = 'success' | 'failed'

export interface RoutineRunRecord {
  routineSlug: string
  routineName: string
  trigger: RoutineRunTrigger
  status: RoutineRunStatus
  /** ISO datetime the fire was scheduled for (for 'manual' = same as actual). */
  scheduledAt: string
  /** ISO datetime the fire actually started executing. */
  startedAt: string
  /** Prompt text as fired. */
  prompt: string
  transcript: RoutineTranscript
  /** Populated only when status === 'failed'. */
  error: string | null
  /** Tool names the routine declared but the host had to drop at fire time. */
  warnings: string[]
}

const HEADER_RE = /^\s*#\s*Run:\s*(.+?)\s*@\s*([0-9T:.\-Z+]+)\s*$/
const BULLET_RE = /^\s*-\s+(.*?)\s*$/
const SECTION_RE = /^\s*##\s+(.+?)\s*$/

const KNOWN_HEADER_LABELS = [
  'routine',
  'routine-name',
  'trigger',
  'status',
  'duration-ms',
  'fire-time-scheduled',
  'fire-time-actual',
  'input-tokens',
  'output-tokens',
  'model',
  'error',
  'warning'
] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format a Date as a filename-safe local timestamp: 2026-05-24T09-00-00 */
export function timestampForFilename(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
  )
}

/** Format a Date as an ISO-like local datetime: 2026-05-24T09:00:00 */
export function isoLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

function summariseInput(input: unknown): string {
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function indentBlock(text: string, indent = '  '): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `${indent}${line}` : ''))
    .join('\n')
}

/**
 * Serialize a single routine run to markdown for storage on disk.
 * The reverse of `parseRunMarkdown`.
 */
export function buildRunMarkdown(run: RoutineRunRecord): string {
  const lines: string[] = []
  lines.push(`# Run: ${run.routineName} @ ${run.scheduledAt}`)
  lines.push(`- routine: ${run.routineSlug}`)
  lines.push(`- trigger: ${run.trigger}`)
  lines.push(`- status: ${run.status}`)
  lines.push(`- fire-time-scheduled: ${run.scheduledAt}`)
  lines.push(`- fire-time-actual: ${run.startedAt}`)
  lines.push(`- duration-ms: ${run.transcript.durationMs}`)
  lines.push(`- input-tokens: ${run.transcript.inputTokens}`)
  lines.push(`- output-tokens: ${run.transcript.outputTokens}`)
  lines.push(`- model: ${run.transcript.modelDisplay}`)
  if (run.error) lines.push(`- error: ${run.error.replace(/\r?\n/g, ' ')}`)
  for (const w of run.warnings) lines.push(`- warning: ${w}`)

  lines.push('', '## Prompt', run.prompt.trim())

  lines.push('', '## Transcript')
  for (const e of run.transcript.entries) {
    switch (e.kind) {
      case 'user_message':
        lines.push(`- user:\n${indentBlock(e.content)}`)
        break
      case 'assistant_thought':
        lines.push(`- assistant (thought):\n${indentBlock(e.content)}`)
        break
      case 'assistant_message':
        lines.push(`- assistant:\n${indentBlock(e.content)}`)
        break
      case 'tool_call':
        lines.push(
          `- tool_call: ${e.toolName} [${e.toolCallId}]\n${indentBlock(summariseInput(e.input))}`
        )
        break
      case 'tool_result':
        lines.push(
          `- tool_result: ${e.toolName} [${e.toolCallId}]\n${indentBlock(e.output)}`
        )
        break
    }
  }

  lines.push('', '## Final Response', run.transcript.finalText.trim() || '(no final response)')

  return lines.join('\n') + '\n'
}

interface ParsedRunHeader {
  routineName: string
  scheduledAt: string
  routineSlug: string
  trigger: RoutineRunTrigger
  status: RoutineRunStatus
  startedAt: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  modelDisplay: string
  error: string | null
  warnings: string[]
}

function emptyHeader(routineName: string, scheduledAt: string): ParsedRunHeader {
  return {
    routineName,
    scheduledAt,
    routineSlug: '',
    trigger: 'scheduled',
    status: 'success',
    startedAt: scheduledAt,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelDisplay: 'unknown',
    error: null,
    warnings: []
  }
}

/**
 * Parse a run markdown file. Tolerant of missing fields — anything absent
 * gets a sensible default so a partially-written or hand-edited file still
 * loads.
 */
export function parseRunMarkdown(content: string): RoutineRunRecord {
  const lines = content.split(/\r?\n/)
  let header: ParsedRunHeader = emptyHeader('Untitled', '')

  // First pass: header line + bullets, until first '##' section.
  let i = 0
  for (; i < lines.length; i += 1) {
    const line = lines[i]
    const h = line.match(HEADER_RE)
    if (h) {
      header = emptyHeader(h[1].trim(), h[2].trim())
      continue
    }
    if (line.match(SECTION_RE)) break
    const bm = line.match(BULLET_RE)
    if (!bm) continue
    const bullet = bm[1]
    const colon = bullet.indexOf(':')
    if (colon < 0) continue
    const label = bullet.slice(0, colon).trim().toLowerCase()
    const value = bullet.slice(colon + 1).trim()
    if (!(KNOWN_HEADER_LABELS as readonly string[]).includes(label)) continue
    switch (label) {
      case 'routine':
        header.routineSlug = value
        break
      case 'routine-name':
        header.routineName = value
        break
      case 'trigger':
        header.trigger = value === 'manual' ? 'manual' : 'scheduled'
        break
      case 'status':
        header.status = value === 'failed' ? 'failed' : 'success'
        break
      case 'fire-time-scheduled':
        header.scheduledAt = value
        break
      case 'fire-time-actual':
        header.startedAt = value
        break
      case 'duration-ms':
        header.durationMs = Number.parseInt(value, 10) || 0
        break
      case 'input-tokens':
        header.inputTokens = Number.parseInt(value, 10) || 0
        break
      case 'output-tokens':
        header.outputTokens = Number.parseInt(value, 10) || 0
        break
      case 'model':
        header.modelDisplay = value
        break
      case 'error':
        header.error = value
        break
      case 'warning':
        header.warnings.push(value)
        break
    }
  }

  // Section walker — collect Prompt / Transcript / Final Response sections.
  const sections: Record<string, string[]> = {}
  let current: string | null = null
  for (; i < lines.length; i += 1) {
    const line = lines[i]
    const sm = line.match(SECTION_RE)
    if (sm) {
      current = sm[1].trim()
      if (!sections[current]) sections[current] = []
      continue
    }
    if (current) {
      const arr = sections[current]
      if (arr) arr.push(line)
    }
  }

  const prompt = (sections['Prompt'] ?? []).join('\n').trim()
  const finalText = (sections['Final Response'] ?? []).join('\n').trim()
  const entries = parseTranscriptSection(sections['Transcript'] ?? [])

  return {
    routineSlug: header.routineSlug,
    routineName: header.routineName,
    trigger: header.trigger,
    status: header.status,
    scheduledAt: header.scheduledAt,
    startedAt: header.startedAt,
    prompt,
    transcript: {
      entries,
      finalText,
      durationMs: header.durationMs,
      inputTokens: header.inputTokens,
      outputTokens: header.outputTokens,
      modelDisplay: header.modelDisplay
    },
    error: header.error,
    warnings: header.warnings
  }
}

const TRANSCRIPT_BULLET_RE = /^\s*-\s+(user|assistant \(thought\)|assistant|tool_call|tool_result):\s*(.*?)\s*$/

function dedentBlock(lines: string[]): string {
  return lines.map((l) => l.replace(/^ {2}/, '')).join('\n').trim()
}

function parseTranscriptSection(lines: string[]): RoutineTranscriptEntry[] {
  const out: RoutineTranscriptEntry[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(TRANSCRIPT_BULLET_RE)
    if (!m) {
      i += 1
      continue
    }
    const tag = m[1]
    const trailing = m[2]
    // Collect the indented continuation lines (start with 2 spaces, or blanks)
    const body: string[] = []
    if (trailing && tag !== 'tool_call' && tag !== 'tool_result') {
      body.push(trailing)
    }
    let j = i + 1
    while (j < lines.length && (lines[j].startsWith('  ') || lines[j] === '')) {
      body.push(lines[j])
      j += 1
    }
    const bodyText = dedentBlock(body)
    if (tag === 'user') {
      out.push({ kind: 'user_message', content: bodyText })
    } else if (tag === 'assistant (thought)') {
      out.push({ kind: 'assistant_thought', content: bodyText })
    } else if (tag === 'assistant') {
      out.push({ kind: 'assistant_message', content: bodyText })
    } else if (tag === 'tool_call') {
      // trailing was: `<toolName> [<id>]`
      const meta = trailing.match(/^(\S+)\s+\[([^\]]+)\]\s*$/)
      const toolName = meta?.[1] ?? trailing.trim() ?? 'unknown'
      const toolCallId = meta?.[2] ?? ''
      let input: unknown = bodyText
      try {
        input = JSON.parse(bodyText)
      } catch {
        /* leave as raw string */
      }
      out.push({ kind: 'tool_call', toolName, toolCallId, input })
    } else if (tag === 'tool_result') {
      const meta = trailing.match(/^(\S+)\s+\[([^\]]+)\]\s*$/)
      const toolName = meta?.[1] ?? trailing.trim() ?? 'unknown'
      const toolCallId = meta?.[2] ?? ''
      out.push({ kind: 'tool_result', toolName, toolCallId, output: bodyText })
    }
    i = j
  }
  return out
}
