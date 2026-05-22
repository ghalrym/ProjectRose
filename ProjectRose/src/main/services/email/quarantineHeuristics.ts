// Heuristic-only prompt-injection scanner for incoming email.
//
// Runs locally with no LLM call. Four rule families each return zero or more
// reasons; if any rule fires, the message is quarantined and the agent never
// sees its body via the read tools — only `email_list_quarantined` (and the
// off-by-default `email_release_from_quarantine`) can surface it.

import type { EmailMessage, QuarantineReason } from '../../../shared/email'

export interface QuarantineVerdict {
  flagged: boolean
  reasons: QuarantineReason[]
}

// ── Rule 1: phrase regex bank ───────────────────────────────────────────
//
// Well-known prompt-injection seeds. Match against the plain body and the
// subject. Listed verbose so additions are easy to review.

const PHRASE_PATTERNS: RegExp[] = [
  /ignore (?:all )?(?:previous|prior|above) instructions/i,
  /disregard (?:the )?(?:system|previous) prompt/i,
  /forget everything (?:above|before|prior)/i,
  /new instructions[:\-]/i,
  /system prompt[:\-]/i,
  /your (?:real|true) instructions are/i,
  /you must (?:now )?reveal/i,
  /print (?:the|your) (?:full )?system prompt/i,
  /show (?:me )?(?:your|the) instructions/i
]

function scanPhrases(text: string): QuarantineReason[] {
  const out: QuarantineReason[] = []
  for (const pat of PHRASE_PATTERNS) {
    const m = text.match(pat)
    if (m) out.push({ rule: 'phrase', detail: m[0] })
  }
  return out
}

// ── Rule 2: hidden text in HTML body ────────────────────────────────────
//
// Attackers hide a payload from human readers but the parser still sees it.
// We look for inline styles that effectively erase content (display:none,
// visibility:hidden, opacity:0, font-size:0, color matching background).

const HIDDEN_STYLE_PATTERNS: RegExp[] = [
  /style="[^"]*\bdisplay\s*:\s*none\b[^"]*"/i,
  /style="[^"]*\bvisibility\s*:\s*hidden\b[^"]*"/i,
  /style="[^"]*\bopacity\s*:\s*0(?:\.0+)?\b[^"]*"/i,
  /style="[^"]*\bfont-size\s*:\s*0(?:px|pt|em)?\b[^"]*"/i,
  /style="[^"]*\bcolor\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))[^"]*background(?:-color)?\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i
]

function scanHiddenText(html: string | undefined): QuarantineReason[] {
  if (!html) return []
  const out: QuarantineReason[] = []
  for (const pat of HIDDEN_STYLE_PATTERNS) {
    const m = html.match(pat)
    if (m) out.push({ rule: 'hidden-text', detail: m[0].slice(0, 120) })
  }
  return out
}

// ── Rule 3: role-claim patterns ─────────────────────────────────────────
//
// "You are now an administrator" / "from now on you are" — classic role
// override attempts that almost never appear in legitimate human email.

const ROLE_CLAIM_PATTERNS: RegExp[] = [
  /you are (?:now )?an? (?:assistant|admin|administrator|developer|operator|jailbroken|unrestricted)/i,
  /from now on,? you (?:are|will|must)/i,
  /act as (?:if you were )?(?:a |an )?(?:admin|developer|root|jailbroken)/i,
  /pretend (?:to be|you are) (?:a |an )?(?:admin|developer|root|jailbroken)/i
]

function scanRoleClaims(text: string): QuarantineReason[] {
  const out: QuarantineReason[] = []
  for (const pat of ROLE_CLAIM_PATTERNS) {
    const m = text.match(pat)
    if (m) out.push({ rule: 'role-claim', detail: m[0] })
  }
  return out
}

// ── Rule 4: imperative density ──────────────────────────────────────────
//
// Legitimate email is mostly declarative. A body that's overwhelmingly
// "do X. then do Y. now run Z." is suspicious — most messages don't read
// like a command list.

const IMPERATIVE_VERBS = new Set([
  'ignore', 'disregard', 'forget', 'reveal', 'print', 'show', 'execute',
  'run', 'do', 'send', 'reply', 'forward', 'call', 'invoke', 'fetch',
  'download', 'open', 'click', 'paste', 'export', 'transfer', 'delete',
  'remove', 'output', 'list', 'dump', 'tell', 'give', 'provide', 'follow'
])

function imperativeDensityScore(text: string): number {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (sentences.length === 0) return 0
  let imperatives = 0
  for (const s of sentences) {
    const firstWord = s.match(/^[A-Za-z']+/)?.[0]?.toLowerCase()
    if (firstWord && IMPERATIVE_VERBS.has(firstWord)) imperatives += 1
  }
  return imperatives / sentences.length
}

function scanImperativeDensity(text: string): QuarantineReason[] {
  const score = imperativeDensityScore(text)
  if (score > 0.4) {
    return [{ rule: 'imperative-density', detail: `${Math.round(score * 100)}% of sentences begin with an imperative verb` }]
  }
  return []
}

// ── Composite scanner ───────────────────────────────────────────────────

export function scanForQuarantine(message: EmailMessage): QuarantineVerdict {
  const haystack = `${message.subject}\n${message.body}`
  const reasons: QuarantineReason[] = [
    ...scanPhrases(haystack),
    ...scanRoleClaims(haystack),
    ...scanHiddenText(message.bodyHtml),
    ...scanImperativeDensity(message.body)
  ]
  return { flagged: reasons.length > 0, reasons }
}
