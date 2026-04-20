import { platform } from 'os'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { setActiveProjectRoot } from './toolHandlers'
import { discoverPythonTools, getModifiedFiles, resetModifiedFiles } from './toolHandlers'
import { streamChat, compressMessages } from './llmClient'
import { readSettings } from '../ipc/settingsHandlers'
import type { Message } from '../../shared/roseModelTypes'

// ── System prompt ──

const FALLBACK_AGENT_MD = `You are RoseEditor AI, a coding assistant embedded in the RoseEditor IDE.

Reply in plain text. Only use tools when the user explicitly asks you to do something — read a file, run a command, search the code, etc. Never call tools for greetings, questions, or conversational messages.
`

async function buildAgentMd(rootPath: string): Promise<string> {
  const os = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux'
  const shell = platform() === 'win32' ? 'PowerShell' : 'bash'
  const date = new Date().toISOString().split('T')[0]

  let rose = FALLBACK_AGENT_MD
  try {
    rose = await readFile(join(rootPath, 'ROSE.md'), 'utf-8')
  } catch {
    // ROSE.md not yet created — use fallback
  }

  return `${rose}

## Environment
- Operating system: ${os}
- Shell: ${shell} (run_command uses ${shell})
- Use ${shell} syntax for all commands (e.g. ${platform() === 'win32' ? 'Get-ChildItem, Get-Content, Test-Path' : 'ls, cat, test'})
- Today's date: ${date}
`
}

const HEARTBEAT_SYSTEM_PROMPT = `You are an autonomous agent processing a deferred work queue.
Execute every item completely. Do not ask for confirmation — just do the work.
Use available tools (read_file, write_file, run_command, list_directory) to accomplish each task.
`

// ── Public API ──

export interface ChatResponse {
  content: string
  modifiedFiles: string[]
}

export async function chat(messages: Message[], rootPath: string): Promise<ChatResponse> {
  setActiveProjectRoot(rootPath)
  resetModifiedFiles()

  const settings = await readSettings()
  const pythonTools = await discoverPythonTools(rootPath)

  await streamChat({
    messages,
    systemPrompt: await buildAgentMd(rootPath),
    pythonTools,
    config: settings,
    projectRoot: rootPath
  })

  return { content: '', modifiedFiles: getModifiedFiles() }
}

export async function heartbeatChat(messages: Message[], rootPath: string): Promise<ChatResponse> {
  setActiveProjectRoot(rootPath)
  resetModifiedFiles()

  const settings = await readSettings()

  await streamChat({
    messages,
    systemPrompt: HEARTBEAT_SYSTEM_PROMPT,
    pythonTools: [],
    config: settings,
    projectRoot: rootPath
  })

  return { content: '', modifiedFiles: getModifiedFiles() }
}

export async function compressHistory(messages: Message[]): Promise<Message[]> {
  const settings = await readSettings()
  return compressMessages(messages, settings)
}
