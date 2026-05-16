import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { SkillMeta } from './skillService'

export const skillIpc = defineIpc('skills', {
  list: method<[rootPath: string], SkillMeta[]>(),
  delete: method<[rootPath: string, name: string], void>()
})
