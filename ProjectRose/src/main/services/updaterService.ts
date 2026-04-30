import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC } from '../../shared/ipcChannels'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

let initialized = false

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function initAutoUpdater(): void {
  if (initialized) return
  if (!app.isPackaged) {
    log.info('[updater] skipping autoUpdater: dev mode')
    return
  }
  if (process.platform === 'darwin') {
    log.info('[updater] skipping autoUpdater: macOS not signed/notarized')
    return
  }

  initialized = true

  log.transports.file.level = 'info'
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast(IPC.UPDATER_AVAILABLE, {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('download-progress', (info: ProgressInfo) => {
    broadcast(IPC.UPDATER_PROGRESS, {
      percent: info.percent,
      bytesPerSecond: info.bytesPerSecond,
      transferred: info.transferred,
      total: info.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcast(IPC.UPDATER_DOWNLOADED, {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('error', (err: Error) => {
    broadcast(IPC.UPDATER_ERROR, { message: err?.message ?? String(err) })
  })

  void autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] initial check failed', err)
  })
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[updater] periodic check failed', err)
    })
  }, SIX_HOURS_MS)
}

export async function checkForUpdatesNow(): Promise<void> {
  if (!initialized) return
  await autoUpdater.checkForUpdates()
}

export function installUpdateAndRestart(): void {
  if (!initialized) return
  autoUpdater.quitAndInstall()
}
