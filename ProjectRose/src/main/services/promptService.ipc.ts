import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { ExtensionPromptListEntry, ExtensionPromptRead } from './promptService'

export const promptIpc = defineIpc('prompts', {
  readRose: method<[rootPath: string], string>(),
  writeRose: method<[rootPath: string, content: string], void>(),
  listExtension: method<[rootPath: string], ExtensionPromptListEntry[]>(),
  readExtension: method<[rootPath: string, extId: string], ExtensionPromptRead>(),
  writeExtension: method<[rootPath: string, extId: string, content: string], void>(),
  resetExtension: method<[rootPath: string, extId: string], void>()
})
