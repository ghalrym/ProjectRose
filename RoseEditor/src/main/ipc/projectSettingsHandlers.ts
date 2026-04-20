import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { ipcMain } from 'electron'
import { discoverPythonTools } from '../services/toolHandlers'

export interface ProjectSettings {
  disabledTools: string[]
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { disabledTools: [] }

export const CORE_TOOL_NAMES = new Set([
  'read_file', 'write_file', 'list_directory', 'search_code',
  'find_references', 'run_command', 'get_project_overview'
])

const CORE_TOOL_META = [
  { name: 'read_file', displayName: 'Read File', description: 'Read the contents of any file in the project', type: 'core' as const },
  { name: 'write_file', displayName: 'Write File', description: 'Write or overwrite file contents', type: 'core' as const },
  { name: 'list_directory', displayName: 'List Directory', description: 'List files and subdirectories', type: 'core' as const },
  { name: 'search_code', displayName: 'Search Code', description: 'Search the codebase using natural language queries', type: 'core' as const },
  { name: 'find_references', displayName: 'Find References', description: 'Find symbol references across the project', type: 'core' as const },
  { name: 'run_command', displayName: 'Run Command', description: 'Execute shell commands in the project', type: 'core' as const },
  { name: 'get_project_overview', displayName: 'Project Overview', description: 'Get a structured map of project dependencies', type: 'core' as const },
]

export async function readProjectSettings(rootPath: string): Promise<ProjectSettings> {
  try {
    const content = await readFile(join(rootPath, 'project-settings.json'), 'utf-8')
    return { ...DEFAULT_PROJECT_SETTINGS, ...JSON.parse(content) }
  } catch {
    return { ...DEFAULT_PROJECT_SETTINGS }
  }
}

export function registerProjectSettingsHandlers(): void {
  ipcMain.handle('project:getSettings', (_ev, rootPath: string) =>
    readProjectSettings(rootPath)
  )

  ipcMain.handle('project:setSettings', async (_ev, rootPath: string, patch: Partial<ProjectSettings>) => {
    const current = await readProjectSettings(rootPath)
    const updated = { ...current, ...patch }
    await writeFile(join(rootPath, 'project-settings.json'), JSON.stringify(updated, null, 2))
    return updated
  })

  ipcMain.handle('tools:list', async (_ev, rootPath: string) => {
    const pythonTools = await discoverPythonTools(rootPath)
    const pythonMeta = pythonTools.map((t) => ({
      name: t.name,
      displayName: t.name.replace(/^tool_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: t.description,
      type: 'python' as const
    }))
    return [...CORE_TOOL_META, ...pythonMeta]
  })
}
