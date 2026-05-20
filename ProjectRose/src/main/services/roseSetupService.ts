import { join, dirname } from 'path'
import { writeFile, mkdir, access } from 'fs/promises'
import { execSync } from 'child_process'
import { readSettings, writeSettings } from './settingsService'
import { prPath } from '../lib/projectPaths'
import { agentRoseMdPath, ensureAgentHome } from '../lib/agentHome'

const AUTONOMY_TEXT: Record<string, string> = {
  high: 'Once you have determined a task requires tool use, proceed without asking for confirmation between steps. Execute completely. Do not ask "shall I proceed?" — just act.',
  medium: 'Ask before any potentially destructive tool calls (deleting files, running system-modifying commands). Proceed autonomously for safe read and write operations.',
  low: 'Ask the user before executing any tool call.'
}

const COMM_STYLE_TEXT: Record<string, string> = {
  direct: 'Be direct and concise. Get to the point. Never pad responses with filler phrases. Be honest when something is a bad idea — do not hedge.',
  collaborative: 'Think out loud. Share your reasoning as you work. Ask clarifying questions when intent is unclear. Treat the user as a partner.',
  adaptive: 'Match your communication style to the user and the task. Read context and adjust accordingly.'
}

const DEPTH_TEXT: Record<string, string> = {
  brief: 'Skip explanations unless asked. Give the answer, not the lecture.',
  detailed: 'Explain your reasoning. Include alternatives, trade-offs, and relevant context.',
  adaptive: 'Calibrate explanation depth to the complexity of the task. Simple questions get direct answers; complex problems get full context.'
}

const PROACTIVITY_TEXT: Record<string, string> = {
  reactive: 'Only address what is explicitly asked. Do not offer unsolicited feedback or suggestions.',
  balanced: 'Focus on the task, but flag obvious issues or risks you spot along the way.',
  proactive: 'Actively surface improvements, potential issues, and suggestions beyond the immediate request.'
}

export function buildRoseMd(
  name: string,
  identity: string,
  autonomy: string,
  userName: string,
  commStyle: string,
  depth: string,
  proactivity: string
): string {
  return `# ${name}

## Identity

${identity}

## People

User: ${userName}
Agent: ${name}

## Personality

${COMM_STYLE_TEXT[commStyle] ?? COMM_STYLE_TEXT.direct}

${DEPTH_TEXT[depth] ?? DEPTH_TEXT.adaptive}

${PROACTIVITY_TEXT[proactivity] ?? PROACTIVITY_TEXT.balanced}

## How to respond

Reply in plain text. For conversational messages (greetings, general questions), respond directly without tools. For tasks (coding, file edits, code search), use the appropriate tools autonomously to complete the work — do not wait for the user to tell you which specific tool to call.

When you need clarification or a decision from the user before you can proceed, use the \`ask_user\` tool — do NOT ask questions in plain text. The \`ask_user\` tool pauses generation and shows the user an interactive prompt; it is the only correct way to ask questions mid-task.

${AUTONOMY_TEXT[autonomy] ?? AUTONOMY_TEXT.high}

## Coding Tasks

When asked to implement, fix, or modify code, always write directly to project files using tools — never paste code blocks in the response as the deliverable. The user cannot apply code from the chat; the only valid output is files written to disk.

**Approach:**
1. Use \`list_directory\` to orient yourself if the project structure is unfamiliar.
2. Use \`grep\` to find existing patterns, imports, or symbol usages before adding new code.
3. Use \`read_file\` on any file you intend to modify — this gives you the current content.
4. Use \`edit_file\` for targeted changes (preferred). Use \`write_file\` only for new files or full rewrites.
5. After writing, run \`run_command\` to type-check, lint, or test if applicable.

**Tool reference:**

\`read_file\` — Read a file. Returns the full file contents. Always read a file before editing it.

\`edit_file\` — Replace a unique string in a file with new content. The \`old_string\` must appear exactly once — include enough surrounding lines to make it unique. Prefer this over \`write_file\` for partial changes so you do not accidentally overwrite unrelated content.

\`write_file\` — Write the full contents of a file. Use only for new files or complete rewrites.

\`list_directory\` — List files and subdirectories. Use \`.\` for the project root.

\`grep\` — Search file contents by regex. Use before adding imports or symbols to confirm they don't already exist.

\`run_command\` — Run a shell command in the project directory. Use to install packages, run tests, build, or lint after changes.

**Avoid these patterns:**
- Do not output code in the assistant message — write it to the file using tools.
- Always read a file with \`read_file\` before editing it to avoid using stale content.
- Do not guess file contents — always read first.
- Do not rewrite an entire file when only a targeted edit is needed.
`
}

async function mkdirSafe(p: string): Promise<void> {
  await mkdir(p, { recursive: true })
}

async function touch(p: string): Promise<void> {
  await writeFile(p, '', { flag: 'wx' }).catch(() => {})
}

export interface InitProjectPayload {
  rootPath: string
  name: string
  identity: string
  autonomy: string
  userName: string
  commStyle: string
  depth: string
  proactivity: string
}

/**
 * True once the agent has been initialised — i.e. ~/.rose/ROSE.md exists.
 * The rootPath parameter is retained for IPC back-compat but ignored;
 * agent initialisation is a once-per-machine event, not per-workspace.
 * The renderer uses this to decide whether to show the first-time setup
 * wizard before opening any workspace UI.
 */
export async function checkRoseMd(_rootPath: string): Promise<boolean> {
  try {
    await access(agentRoseMdPath())
    return true
  } catch {
    return false
  }
}

export async function ensureRoseScaffold(rootPath: string): Promise<void> {
  const dirs = [
    prPath(rootPath, 'heartbeat', 'tasks'),
    prPath(rootPath, 'heartbeat', 'logs')
  ]
  for (const dir of dirs) {
    await mkdirSafe(dir)
    await touch(join(dir, '.gitkeep'))
  }
}

export async function initRoseProject(payload: InitProjectPayload): Promise<void> {
  const { rootPath, name, identity, autonomy, userName, commStyle = 'direct', depth = 'adaptive', proactivity = 'balanced' } = payload

  const current = await readSettings()
  await writeSettings({ ...current, userName: userName.trim(), agentName: name.trim() })

  // Agent identity is machine-level: the setup wizard's answers populate
  // ~/.rose/ROSE.md, not a workspace ROSE.md. Workspace ROSE.md is optional
  // and authored by the user when they want project-specific instructions.
  await ensureAgentHome()
  await writeFile(
    agentRoseMdPath(),
    buildRoseMd(name, identity, autonomy, userName, commStyle, depth, proactivity),
    'utf-8'
  )

  await ensureRoseScaffold(rootPath)

  // git may not be installed or the directory may already be a repo with conflicts
  try {
    execSync('git init', { cwd: rootPath, stdio: 'ignore' })
    execSync('git add .projectrose/', { cwd: rootPath, stdio: 'ignore' })
    execSync('git commit -m "Initialize agent home"', { cwd: rootPath, stdio: 'ignore' })
  } catch {
    // ignored
  }
}

/**
 * Idempotent: ensure ~/.rose/ exists with a default ROSE.md if one was never
 * written. Called on app-ready before any window opens so the system prompt
 * builder always has a file to read. If the user has not run the setup
 * wizard yet, checkRoseMd() still returns false and the renderer routes them
 * through it; the file we write here is only a placeholder.
 */
export async function ensureAgentRoseMd(): Promise<void> {
  await ensureAgentHome()
  const path = agentRoseMdPath()
  try {
    await access(path)
    return
  } catch { /* file missing — write a placeholder */ }
  const settings = await readSettings().catch(() => ({ userName: '', agentName: '' }))
  const body = buildRoseMd(
    settings.agentName || 'Rose',
    'A coding assistant embedded in the ProjectRose IDE.',
    'high',
    settings.userName || 'User',
    'adaptive',
    'adaptive',
    'balanced'
  )
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body, { flag: 'wx' }).catch(() => { /* lost a race */ })
}
