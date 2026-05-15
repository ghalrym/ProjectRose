import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { InitProjectPayload } from './roseSetupService'

export const roseSetupIpc = defineIpc('rose', {
  checkMd: method<[rootPath: string], boolean>(),
  initProject: method<[payload: InitProjectPayload], void>(),
  ensureScaffold: method<[rootPath: string], void>()
})
