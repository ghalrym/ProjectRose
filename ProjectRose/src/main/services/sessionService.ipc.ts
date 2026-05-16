import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { Session, SessionMeta } from './sessionService'

export const sessionIpc = defineIpc('session', {
  list: method<[rootPath: string], SessionMeta[]>(),
  load: method<[rootPath: string, sessionId: string], Session | null>(),
  save: method<[rootPath: string, session: Session], void>(),
  delete: method<[rootPath: string, sessionId: string], void>()
})
