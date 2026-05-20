import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { RecentProject } from './recentProjects'

export const recentProjectsIpc = defineIpc('projects', {
  getRecent: method<[], RecentProject[]>(),
  addRecent: method<[projectPath: string], RecentProject[]>(),
  removeRecent: method<[projectPath: string], RecentProject[]>()
})
