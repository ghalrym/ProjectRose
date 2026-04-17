import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import {
  getRecentProjects,
  addRecentProject,
  removeRecentProject
} from '../services/recentProjects'

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC.PROJECTS_GET_RECENT, () => {
    return getRecentProjects()
  })

  ipcMain.handle(IPC.PROJECTS_ADD_RECENT, (_event, projectPath: string) => {
    return addRecentProject(projectPath)
  })

  ipcMain.handle(IPC.PROJECTS_REMOVE_RECENT, (_event, projectPath: string) => {
    return removeRecentProject(projectPath)
  })
}
