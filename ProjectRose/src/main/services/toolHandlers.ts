import { readFile, writeFile, readdir, mkdir, stat } from 'fs/promises'
import { join, basename, dirname } from 'path'
import { execSync } from 'child_process'
import { platform } from 'os'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { lspRequest } from './lspManager'

const modifiedFiles: string[] = []
let _activeProjectRoot: string | null = null

export function resetModifiedFiles(): void {
  modifiedFiles.length = 0
}

export function getModifiedFiles(): string[] {
  return modifiedFiles.splice(0)
}

export function setActiveProjectRoot(rootPath: string): void {
  _activeProjectRoot = rootPath
}

function notifyRenderer(event: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, data)
    }
  }
}

export async function handleReadFile(input: Record<string, unknown>, projectRoot: string): Promise<string> {
  const filePath = String(input.path || '')
  const absolute = filePath.startsWith('/') || filePath.includes(':')
    ? filePath
    : join(projectRoot, filePath)

  if (basename(absolute) === '.env' || basename(absolute).startsWith('.env.')) {
    return 'Access denied: .env files cannot be read.'
  }

  try {
    return await readFile(absolute, 'utf-8')
  } catch {
    return 'File does not exist.'
  }
}

export async function handleWriteFile(input: Record<string, unknown>, projectRoot: string): Promise<string> {
  const filePath = String(input.path || '')
  const absolute = filePath.startsWith('/') || filePath.includes(':')
    ? filePath
    : join(projectRoot, filePath)

  const content = String(input.content ?? '')
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf-8')
  modifiedFiles.push(absolute)
  notifyRenderer(IPC.AI_FILE_MODIFIED, { path: absolute })

  return `File written: ${filePath}`
}

export async function handleEditFile(input: Record<string, unknown>, projectRoot: string): Promise<string> {
  const filePath = String(input.path || '')
  const absolute = filePath.startsWith('/') || filePath.includes(':')
    ? filePath
    : join(projectRoot, filePath)

  const oldString = String(input.old_string ?? '')
  const newString = String(input.new_string ?? '')

  const content = await readFile(absolute, 'utf-8')
  const occurrences = content.split(oldString).length - 1
  if (occurrences === 0) {
    return `old_string not found in ${filePath}. Read the file again to get current content before editing.`
  }
  if (occurrences > 1) {
    return `old_string matches ${occurrences} locations in ${filePath}. Provide more surrounding context to make it unique.`
  }

  const updated = content.replace(oldString, newString)
  await writeFile(absolute, updated, 'utf-8')
  modifiedFiles.push(absolute)
  notifyRenderer(IPC.AI_FILE_MODIFIED, { path: absolute })

  return `File edited: ${filePath}`
}

export async function handleListDirectory(input: Record<string, unknown>, projectRoot: string): Promise<string> {
  const dirPath = String(input.path || '.')
  const absolute = dirPath.startsWith('/') || dirPath.includes(':')
    ? dirPath
    : join(projectRoot, dirPath)
  const entries = await readdir(absolute, { withFileTypes: true })
  return JSON.stringify(entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })))
}

export async function handleSearchCode(input: Record<string, unknown>): Promise<string> {
  const query = String(input.query || '')
  const limit = Number(input.limit) || 10

  // Try TypeScript server first (most projects are TS), then Python
  for (const server of ['ts', 'py'] as const) {
    try {
      const results = await lspRequest(server, 'workspace/symbol', { query }) as any[]
      if (!Array.isArray(results) || results.length === 0) continue
      const formatted = results.slice(0, limit).map((s: any) => ({
        name: s.name,
        kind: s.kind,
        location: s.location,
        containerName: s.containerName
      }))
      return JSON.stringify(formatted)
    } catch { /* try next server */ }
  }

  return JSON.stringify({ message: 'No language server available or no results found for: ' + query })
}

export async function handleFindReferences(input: Record<string, unknown>): Promise<string> {
  const symbolName = String(input.symbol_name || '')

  // Find the symbol location via workspace/symbol
  for (const server of ['ts', 'py'] as const) {
    try {
      const symbols = await lspRequest(server, 'workspace/symbol', { query: symbolName }) as any[]
      if (!Array.isArray(symbols) || symbols.length === 0) continue

      const target = symbols.find((s: any) => s.name === symbolName) ?? symbols[0]
      const loc = target.location
      if (!loc?.uri || !loc?.range) continue

      const refs = await lspRequest(server, 'textDocument/references', {
        textDocument: { uri: loc.uri },
        position: loc.range.start,
        context: { includeDeclaration: true }
      }) as any[]

      return JSON.stringify(Array.isArray(refs) ? refs : [])
    } catch { /* try next server */ }
  }

  return JSON.stringify({ message: 'No language server available or symbol not found: ' + symbolName })
}


export async function handleRunCommand(input: Record<string, unknown>, projectRoot: string): Promise<string> {
  const command = String(input.command || '')
  const isWindows = platform() === 'win32'
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      shell: isWindows ? 'powershell.exe' : '/bin/bash'
    })
  } catch (err: any) {
    return `Command failed (exit ${err.status || 1}):\n${err.stderr || err.message}`
  }
}

// ── Grep handler ──

const GREP_IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '__pycache__', '.cache'])

async function grepWalk(
  dir: string,
  regex: RegExp,
  includeExts: string[],
  projectRoot: string,
  results: Array<{ rel: string; line: number; text: string }>,
  max: number
): Promise<void> {
  if (results.length >= max) return
  let entries: string[]
  try { entries = await readdir(dir) } catch { return }

  for (const entry of entries) {
    if (results.length >= max) break
    if (GREP_IGNORED.has(entry)) continue
    const full = join(dir, entry)
    let s
    try { s = await stat(full) } catch { continue }

    if (s.isDirectory()) {
      await grepWalk(full, regex, includeExts, projectRoot, results, max)
    } else if (s.isFile()) {
      if (includeExts.length > 0 && !includeExts.some((ext) => entry.endsWith(ext))) continue
      let content: string
      try { content = await readFile(full, 'utf-8') } catch { continue }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && results.length < max; i++) {
        if (regex.test(lines[i])) {
          const rel = full.startsWith(projectRoot) ? full.slice(projectRoot.length).replace(/^[\\/]/, '') : full
          results.push({ rel, line: i + 1, text: lines[i].trim() })
        }
      }
    }
  }
}

export async function handleGrep(input: Record<string, unknown>, projectRoot: string): Promise<string> {
  const pattern = String(input.pattern || '')
  if (!pattern) return 'No pattern provided.'

  let regex: RegExp
  try {
    regex = new RegExp(pattern, input.case_sensitive ? '' : 'i')
  } catch {
    return `Invalid regex: ${pattern}`
  }

  const searchPath = String(input.path || '.')
  const absolute = searchPath.startsWith('/') || searchPath.includes(':')
    ? searchPath
    : join(projectRoot, searchPath)

  const includeExts = String(input.include || '')
    .split(',').map((s) => s.trim().replace(/^\*/, '')).filter(Boolean)

  const results: Array<{ rel: string; line: number; text: string }> = []
  await grepWalk(absolute, regex, includeExts, projectRoot, results, 200)

  if (results.length === 0) return `No matches for: ${pattern}`
  const lines = results.map((r) => `${r.rel}:${r.line}: ${r.text}`)
  return results.length === 200
    ? lines.join('\n') + '\n[truncated at 200 matches]'
    : lines.join('\n')
}

