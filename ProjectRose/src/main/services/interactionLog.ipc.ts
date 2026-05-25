import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { InteractionLogEntry } from '../../shared/interactionLog'

export const interactionLogIpc = defineIpc('interactions', {
  log: method<[kind: string, target?: string], void>(),
  list: method<[limit?: number], InteractionLogEntry[]>()
})
