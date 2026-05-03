import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'
import {
  checkForUpdatesNow,
  downloadUpdateNow,
  installUpdateAndRestart,
  skipVersion
} from '../services/updaterService'

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_CHECK, async () => {
    await checkForUpdatesNow()
  })

  ipcMain.handle(IPC.UPDATER_DOWNLOAD, async () => {
    await downloadUpdateNow()
  })

  ipcMain.handle(IPC.UPDATER_INSTALL, () => {
    installUpdateAndRestart()
  })

  ipcMain.handle(IPC.UPDATER_SKIP_VERSION, async (_event, version: string) => {
    await skipVersion(version)
  })
}
