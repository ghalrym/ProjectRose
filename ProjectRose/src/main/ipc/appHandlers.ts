import { ipcMain, app } from 'electron'
import { IPC } from '../../shared/ipcChannels'

// Single hand-written handler — `app.quit()` is an Electron singleton call and
// doesn't belong in a service. Kept here rather than in the typed manifest so
// the file is honest about what it is.
export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_QUIT, () => {
    app.quit()
  })
}
