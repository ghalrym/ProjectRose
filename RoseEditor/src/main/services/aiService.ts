import { platform } from 'os'
import { RoseModelClient } from './roseModelClient'
import { RoseLibraryClient } from './roseLibraryClient'
import {
  startCallbackServer,
  getCallbackBaseUrl,
  getModifiedFiles,
  updateProjectRoot
} from './aiCallbackServer'
import type { Tool, Message } from '../../shared/roseModelTypes'
import type { RepositoryOverview } from '../../shared/roseLibraryTypes'

const client = new RoseModelClient()
const roseLibrary = new RoseLibraryClient()

function buildTools(): Tool[] {
  const base = getCallbackBaseUrl()

  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file. Use project-relative paths.',
      parameters: {
        path: { type: 'string', description: 'File path relative to the project root' }
      },
      callback_url: `${base}/tools/read_file`
    },
    {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. The code index is updated automatically.',
      parameters: {
        path: { type: 'string', description: 'File path relative to the project root' },
        content: { type: 'string', description: 'The full file content to write' }
      },
      callback_url: `${base}/tools/write_file`
    },
    {
      name: 'list_directory',
      description: 'List files and subdirectories in a directory.',
      parameters: {
        path: { type: 'string', description: 'Directory path relative to the project root. Use "." for the root.' }
      },
      callback_url: `${base}/tools/list_directory`
    },
    {
      name: 'search_code',
      description: 'Search the codebase using a natural language query. Returns matching functions, classes, and methods with their source code, ranked by relevance.',
      parameters: {
        query: { type: 'string', description: 'Natural language description of what you are looking for' },
        limit: { type: 'number', description: 'Max results to return (default 10)' }
      },
      callback_url: `${base}/tools/search_code`
    },
    {
      name: 'find_references',
      description: 'Find all references to or from a symbol. Use direction "inbound" to find callers, "outbound" to find dependencies, or "both" for all references.',
      parameters: {
        symbol_name: { type: 'string', description: 'Name of the function, class, or method' },
        file_path: { type: 'string', description: 'File where the symbol is defined (required if the name is ambiguous)' },
        direction: { type: 'string', description: '"inbound", "outbound", or "both" (default "both")' }
      },
      callback_url: `${base}/tools/find_references`
    },
    {
      name: 'run_command',
      description: 'Run a shell command in the project directory. Use for installing packages, running tests, linting, etc. Returns stdout/stderr.',
      parameters: {
        command: { type: 'string', description: 'The shell command to execute' }
      },
      callback_url: `${base}/tools/run_command`
    }
  ]
}

function formatOverview(overview: RepositoryOverview): string {
  const lines: string[] = [
    `## Repository Map (${overview.total_files} files, ${overview.total_symbols} symbols, ${overview.total_references} references)`,
    ''
  ]

  for (const file of overview.files) {
    const deps = file.depends_on.length > 0 ? ` | depends on: ${file.depends_on.join(', ')}` : ''
    const usedBy = file.depended_on_by.length > 0 ? ` | used by: ${file.depended_on_by.join(', ')}` : ''
    lines.push(`### ${file.path} [${file.language}]${deps}${usedBy}`)

    for (const sym of file.symbols) {
      const params = sym.parameters ? `(${sym.parameters})` : ''
      const doc = sym.docstring ? ` — ${sym.docstring}` : ''
      lines.push(`  - ${sym.type} ${sym.qualified_name}${params}${doc}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}

function buildAgentMd(overview: RepositoryOverview | null): string {
  const os = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux'
  const shell = platform() === 'win32' ? 'PowerShell' : 'bash'

  let md = `You are RoseEditor AI, a coding assistant embedded in the RoseEditor IDE.

You help the user with their codebase by reading, writing, searching, and navigating code.

Environment:
- Operating system: ${os}
- Shell: ${shell} (run_command uses ${shell})
- Use ${shell} syntax for all commands (e.g. ${platform() === 'win32' ? 'Get-ChildItem, Get-Content, Test-Path' : 'ls, cat, test'})

Guidelines:
- Read files before modifying them to understand the existing code.
- Use search_code to find relevant code when you don't know where something is.
- Use find_references before renaming or removing functions to understand impact.
- When you write a file, provide the complete file content.
- Use run_command for tasks like running tests, installing packages, or checking build status.
- Be concise in your explanations. The user can see the code in the editor.
`

  if (overview && overview.files.length > 0) {
    md += '\n' + formatOverview(overview)
  }

  return md
}

export interface ChatResponse {
  content: string
  modifiedFiles: string[]
}

export async function chat(
  messages: Message[],
  rootPath: string
): Promise<ChatResponse> {
  // Ensure callback server is running
  await startCallbackServer(rootPath)
  updateProjectRoot(rootPath)

  // Fetch repository overview for context
  let overview: RepositoryOverview | null = null
  try {
    overview = await roseLibrary.overview()
  } catch {
    // RoseLibrary not available, proceed without overview
  }

  const tools = buildTools()

  const content = await client.generate({
    messages,
    agent_md: buildAgentMd(overview),
    tools
  })

  // Collect any files modified during tool execution
  const modified = getModifiedFiles()

  return { content, modifiedFiles: modified }
}

export async function compressHistory(messages: Message[]): Promise<Message[]> {
  return client.compress(messages)
}
