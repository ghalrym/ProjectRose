import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { AppSettings, ServiceHealth } from './settingsService'

export const settingsIpc = defineIpc('settings', {
  get: method<[rootPath?: string], AppSettings>(),
  set: method<[patch: Partial<AppSettings>, rootPath?: string], AppSettings>()
})

export const healthIpc = defineIpc('health', {
  checkAll: method<[], ServiceHealth[]>()
})
