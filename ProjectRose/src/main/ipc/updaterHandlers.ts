import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import { checkForUpdatesNow, installUpdateAndRestart } from '../services/updaterService'

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_CHECK, async () => {
    await checkForUpdatesNow()
  })

  ipcMain.handle(IPC.UPDATER_INSTALL, () => {
    installUpdateAndRestart()
  })
}
