import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { ProjectSettings } from './projectSettingsService'
import type { ToolMeta } from '../../shared/types'

export const projectSettingsIpc = defineIpc('project', {
  getSettings: method<[rootPath: string], ProjectSettings>(),
  setSettings: method<[rootPath: string, patch: Partial<ProjectSettings>], ProjectSettings>()
})

export const toolsIpc = defineIpc('tools', {
  list: method<[rootPath: string], ToolMeta[]>()
})
