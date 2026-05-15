import { readFile, writeFile } from 'fs/promises'
import { listInstalledExtensions } from '../ipc/extensionHandlers'
import { prPath } from '../lib/projectPaths'
import { toolRegistry } from './toolRegistry'
import type { ToolMeta } from '../../shared/types'

export interface ProjectSettings {
  disabledTools: string[]
  disabledPrompts: string[]
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { disabledTools: [], disabledPrompts: [] }

// User-facing labels for core tools. The list of names that actually exist
// comes from the registry (`toolRegistry.getCoreToolNames()`); this table is
// only the display strings. If a new core tool is registered without a row
// here, it surfaces in the UI with its bare name as fallback.
const CORE_TOOL_DISPLAY: Record<string, { displayName: string; description: string }> = {
  read_file: { displayName: 'Read File', description: 'Read the contents of any file in the project' },
  write_file: { displayName: 'Write File', description: 'Write or overwrite file contents' },
  edit_file: { displayName: 'Edit File', description: 'Replace a unique string in a file (requires prior read_file)' },
  list_directory: { displayName: 'List Directory', description: 'List files and subdirectories' },
  grep: { displayName: 'Grep', description: 'Search file contents by regex pattern' },
  run_command: { displayName: 'Run Command', description: 'Execute shell commands in the project' },
  ask_user: { displayName: 'Ask User', description: 'Pause generation to ask the user a clarifying question' },
  create_subagents: { displayName: 'Subagents', description: 'Spawn one or more subagents to run focused tasks in parallel' },
  explore: { displayName: 'Explore', description: 'Decompose a topic into parallel read-only sub-queries and return a combined report' },
  search_web: { displayName: 'Web Search', description: 'Search the web via the ProjectRose search API' }
}

export async function readProjectSettings(rootPath: string): Promise<ProjectSettings> {
  try {
    const content = await readFile(prPath(rootPath, 'project-settings.json'), 'utf-8')
    return { ...DEFAULT_PROJECT_SETTINGS, ...JSON.parse(content) }
  } catch {
    return { ...DEFAULT_PROJECT_SETTINGS }
  }
}

export async function writeProjectSettings(
  rootPath: string,
  patch: Partial<ProjectSettings>
): Promise<ProjectSettings> {
  const current = await readProjectSettings(rootPath)
  const updated = { ...current, ...patch }
  await writeFile(prPath(rootPath, 'project-settings.json'), JSON.stringify(updated, null, 2))
  return updated
}

export async function listTools(rootPath: string): Promise<ToolMeta[]> {
  const coreMeta = toolRegistry.getCoreToolNames().map((name) => {
    const display = CORE_TOOL_DISPLAY[name]
    return {
      name,
      displayName: display?.displayName ?? name,
      description: display?.description ?? '',
      type: 'core' as const
    }
  })

  const installed = await listInstalledExtensions(rootPath)
  const extensionMeta = installed
    .filter((ext) => ext.enabled && ext.manifest.provides.tools?.length)
    .flatMap((ext) =>
      (ext.manifest.provides.tools ?? []).map((t) => ({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        type: 'extension' as const,
        extensionId: ext.manifest.id,
        extensionName: ext.manifest.name
      }))
    )

  return [...coreMeta, ...extensionMeta]
}
