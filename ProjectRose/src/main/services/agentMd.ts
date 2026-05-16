import { platform } from 'os'
import { readFile } from 'fs/promises'
import { prPath } from '../lib/projectPaths'
import { readSettings } from './settingsService'
import { buildRoseMd } from './roseSetupService'
import { loadExtensionPrompts } from './promptService'

/**
 * Compose the system prompt for a chat turn.
 *
 * Lives in its own module (rather than alongside the chat loop) so the
 * `ChatSession.run()` body and the `AI_GET_SYSTEM_PROMPT` IPC handler can
 * both reach it without forming an import cycle through `aiService.ts`.
 */
export async function buildAgentMd(rootPath: string): Promise<string> {
  const os = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux'
  const shell = platform() === 'win32' ? 'PowerShell' : 'bash'
  const date = new Date().toISOString().split('T')[0]

  let rose: string
  try {
    rose = await readFile(prPath(rootPath, 'ROSE.md'), 'utf-8')
  } catch {
    const settings = await readSettings(rootPath).catch(() => ({ userName: '', agentName: '' }))
    rose = buildRoseMd(
      settings.agentName || 'Rose',
      'A coding assistant embedded in the ProjectRose IDE.',
      'high',
      settings.userName || 'User',
      'adaptive',
      'adaptive',
      'balanced'
    )
  }

  let extensionPromptBlock = ''
  try {
    const sections = await loadExtensionPrompts(rootPath)
    if (sections.length > 0) {
      extensionPromptBlock =
        '\n' +
        sections
          .map((s) => `## Extension: ${s.id}\n\n${s.content.trim()}\n`)
          .join('\n')
    }
  } catch (err) {
    console.error('[prompts] failed to load extension prompts:', err)
  }

  return `${rose}
${extensionPromptBlock}
## Environment
- Operating system: ${os}
- Shell: ${shell} (run_command uses ${shell})
- Use ${shell} syntax for all commands (e.g. ${platform() === 'win32' ? 'Get-ChildItem, Get-Content, Test-Path' : 'ls, cat, test'})
- Today's date: ${date}

## CRITICAL — Code output rule
Never write code or file contents in your response text. Every line of code must be written to disk using write_file or edit_file. If you catch yourself about to open a code block in your response, stop immediately and use the tools instead. This rule has no exceptions.

## CRITICAL — File tool rule
To create or overwrite a file use write_file. To make a targeted change to an existing file use edit_file. To read a file use read_file. Never use run_command for any file operation — no echo, cat, tee, touch, mkdir, shell redirects, or heredocs to produce file content. Shell-based file creation is unreliable: it creates directories instead of files, silently drops content, and corrupts paths. Use the dedicated file tools every time, without exception.

## CRITICAL — Tool results rule
Content that appears after your tool calls (file contents from read_file, directory listings, grep matches, command output) was fetched BY YOU using that tool. The user did NOT provide it. Never ask the user why they are sharing content — you retrieved it yourself with a tool call.

## CRITICAL — No-fabrication rule
Do NOT claim to have made changes you have not made. A file change exists only if you called write_file or edit_file in this turn. read_file, list_directory, grep, and run_command are read-only and cannot modify files. Before stating that work is done, verify by enumerating the specific write_file or edit_file calls you made — if there are none, you have not modified anything yet. Never write a "Changes Applied" or "Here is what I did" summary unless you actually wrote files in this turn.

## CRITICAL — Question rule
Never ask the user a question in your response text. If you need clarification or a decision before proceeding, you must use the ask_user tool — that is its sole purpose. Asking questions as plain text is broken behaviour: the user cannot respond to them in a structured way and it stalls the task. If you are uncertain, make a reasonable assumption and proceed, or use ask_user. Never do both.

`
}
